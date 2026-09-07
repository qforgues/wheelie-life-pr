import type { BikeState } from '../sim/types';
import { hardReload } from '../core/UpdateWatcher';
import type { BikeTuning } from '../sim/tuning';
import type { WheelieTracker } from '../game/WheelieTracker';
import { TRICKS } from '../sim/tuning';

const TRICK_LABEL: Record<string, string> = {
  knee: 'KNEE',
  stand: 'STAND',
  none: '',
};

const MS_TO_MPH = 2.23694;
const MS_TO_KMH = 3.6;

/**
 * Speed, gear, tacho, wheelie distance. Nothing else.
 *
 * There is no balance meter and there will not be one. Balance is read off the
 * horizon, the engine note, the tail scraping and the pad rumble - see
 * docs/DECISIONS.md #3.
 */
export class Hud {
  readonly root: HTMLDivElement;

  private speedValue!: HTMLElement;
  private speedAlt!: HTMLElement;
  private gearValue!: HTMLElement;
  private tachFill!: HTMLElement;
  private tachBar!: HTMLElement;
  private runBlock!: HTMLElement;
  private runValue!: HTMLElement;
  private runTime!: HTMLElement;
  private bestValue!: HTMLElement;
  private lastValue!: HTMLElement;
  private trick!: HTMLElement;
  private cashValue!: HTMLElement;
  private banner!: HTMLElement;
  private toast!: HTMLElement;
  private updateChip!: HTMLElement;
  private toastTimer = 0;
  /** Set by the game when a crash starts, so the banner and the spoken call
   *  are the same line. */
  crashCall = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-topleft">
        <div class="hud-run" data-el="runBlock">
          <div class="hud-label">WHEELIE</div>
          <div class="hud-run-value"><span data-el="runValue">0.0</span><em>m</em></div>
          <div class="hud-run-time"><span data-el="runTime">0.0</span>s</div>
          <div class="hud-trick" data-el="trick"></div>
        </div>
        <div class="hud-stat">
          <span class="hud-label">BEST</span>
          <span class="hud-strong" data-el="bestValue">0.0 m</span>
        </div>
        <div class="hud-stat">
          <span class="hud-label">LAST</span>
          <span class="hud-strong" data-el="lastValue">0.0 m</span>
        </div>
        <div class="hud-stat hud-cash">
          <span class="hud-label">CASH</span>
          <span class="hud-strong" data-el="cashValue">$0</span>
        </div>
      </div>

      <div class="hud-bottomright">
        <div class="hud-tach"><div class="hud-tach-fill" data-el="tachFill"></div></div>
        <div class="hud-cluster">
          <div class="hud-speed">
            <span data-el="speedValue">0</span>
            <em>MPH</em>
            <span class="hud-speed-alt" data-el="speedAlt">0 km/h</span>
          </div>
          <div class="hud-gear">
            <span class="hud-label">GEAR</span>
            <span class="hud-gear-value" data-el="gearValue">1</span>
          </div>
        </div>
      </div>

      <div class="hud-banner" data-el="banner"></div>
      <div class="hud-toast" data-el="toast"></div>
      <button class="hud-update" data-el="updateChip" type="button" hidden>
        UPDATE READY<small>open the menu to install</small>
      </button>
    `;

    for (const el of this.root.querySelectorAll<HTMLElement>('[data-el]')) {
      (this as unknown as Record<string, HTMLElement>)[el.dataset.el!] = el;
    }
    this.tachBar = this.root.querySelector('.hud-tach')!;
    this.updateChip.addEventListener('click', () => { void hardReload(); });
  }

  /** Money on hand, written by the game each frame. */
  cash = 0;

  update(
    state: BikeState, tracker: WheelieTracker, tuning: BikeTuning, dt: number,
  ): void {
    this.cashValue.textContent = '$' + Math.round(this.cash).toLocaleString('en-US');
    const mph = state.speed * MS_TO_MPH;
    this.speedValue.textContent = mph.toFixed(0);
    this.speedAlt.textContent = `${(state.speed * MS_TO_KMH).toFixed(0)} km/h`;
    this.gearValue.textContent = String(state.gear + 1);

    const rpmFrac = Math.min(1, state.rpm / tuning.engine.limiterRpm);
    this.tachFill.style.width = `${rpmFrac * 100}%`;
    const nearRedline = state.rpm > tuning.engine.redlineRpm * 0.94;
    this.tachBar.classList.toggle('is-redline', nearRedline);
    this.tachBar.classList.toggle('is-limiter', state.onLimiter);

    // The live run counter only shows while you're actually up.
    const showing = tracker.active;
    this.runBlock.classList.toggle('is-active', showing);
    const run = showing ? tracker.current : tracker.last;
    // Distance is raw metres; tricks multiply what the run banks, so show the
    // bonus rather than silently inflating the distance.
    this.runValue.textContent = run.distance.toFixed(1);
    const bonus = run.score - run.distance;
    this.trick.textContent = state.trick !== 'none'
      ? `${TRICK_LABEL[state.trick]}  ×${(1 + (state.trickBlend * (TRICKS[state.trick].scoreMultiplier - 1))).toFixed(1)}`
      : bonus > 0.5 ? `+${bonus.toFixed(0)} m style` : '';
    this.trick.classList.toggle('is-on', state.trick !== 'none');
    this.runTime.textContent = run.duration.toFixed(1);
    this.bestValue.textContent = `${tracker.best.score.toFixed(1)} m`;
    this.lastValue.textContent = `${tracker.last.distance.toFixed(1)} m`;
    // A run you fell out of still shows, but it's marked as not counting.
    this.lastValue.classList.toggle('is-void', !tracker.lastBanked && tracker.last.distance > 0);

    if (state.mode === 'crashed') {
      this.banner.classList.add('is-visible');
      const lost = !tracker.lastBanked && tracker.last.distance > 0.5
        ? `<div class="hud-banner-void">${tracker.last.distance.toFixed(1)} m — didn't count, you have to land it</div>`
        : '';
      this.banner.innerHTML = `
        <div class="hud-banner-title">${this.crashCall}</div>
        <div class="hud-banner-sub">${crashSub(state.crashReason)}</div>${lost}`;
    } else {
      this.banner.classList.remove('is-visible');
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('is-visible');
    }
  }

  /**
   * Raises the "a new build is live" chip and leaves it there.
   *
   * Deliberately not a toast: this one must not time out, because the whole
   * point is that the player installs it when *they* are ready. Clicking works
   * on a mouse; on a controller the menu carries the same button, which is what
   * the small print says.
   */
  showUpdate(): void {
    this.updateChip.hidden = false;
  }

  showToast(text: string, seconds = 2.4): void {
    this.toast.textContent = text;
    this.toast.classList.add('is-visible');
    this.toastTimer = seconds;
  }
}

function crashSub(reason: string | null): string {
  switch (reason) {
    case 'looped': return 'Looped it out — stab the brake next time';
    case 'lowside': return 'Lost it sideways — feather the steer to hold it up';
    case 'impact': return 'Watch the calle';
    default: return '';
  }
}
