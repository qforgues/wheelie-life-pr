import { bindingsFor, type PadFamily } from '../input/bindings';
import { BIKE_VISUALS } from '../view/bikeVisuals';
import { BIKES, type BikeId } from '../sim/tuning';

/**
 * The keyboard/pad mapping card. Shown on first load, dismissed with H or any
 * throttle input; the whole thing renders from input/bindings.ts so the card can
 * never drift from the actual mapping.
 */
export class ControlsOverlay {
  readonly root: HTMLDivElement;
  private visible = true;
  private deviceLine: HTMLElement;
  private tableBody: HTMLElement;
  private family: PadFamily | null = null;
  private padHeader: HTMLElement;

  private selected: BikeId = 'yz250f';
  private onPick: ((id: BikeId) => void) | null = null;

  constructor(private onDismiss: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="overlay-card">
        <div class="overlay-crown">♛</div>
        <h1>WHEELIE LIFE <span>PR</span></h1>
        <p class="overlay-tag">CALLES ♛ BIKES ♛ ISLA ♛ LIBERTAD</p>
        <p class="overlay-device" data-el="device">Checking for a controller…</p>

        <div class="bike-pick" data-el="bikePick">
          ${(Object.keys(BIKES) as BikeId[]).map((id) => {
            const v = BIKE_VISUALS[id];
            return `
            <button class="bike" data-bike="${id}" type="button">
              <span class="bike-swatch" style="--paint:#${v.bodyColor.toString(16).padStart(6, '0')}"></span>
              <span class="bike-name">${v.displayName}</span>
              <span class="bike-tag">${v.tagline}</span>
              <span class="bike-char">${v.character}</span>
            </button>`;
          }).join('')}
        </div>
        <table class="overlay-table">
          <thead><tr><th>Action</th><th data-el="padHeader">Controller</th><th>Keyboard</th></tr></thead>
          <tbody data-el="tableBody"></tbody>
        </table>
        <div class="overlay-tips">
          <p><b>To get it up:</b> low gear, pin the throttle and pull back at the same time.</p>
          <p><b>To hold it:</b> ride the throttle. Too far over? A stab of brake brings the nose down.</p>
          <p><b>Listen.</b> When the tail starts scraping you are one heartbeat from looping it.</p>
          <p><b>Tricks:</b> once the front is up, hold a trick button to get a knee on the seat or stand right up. Standing scores most and is hardest to hold.</p>
        </div>
        <button class="overlay-go" data-el="go">RIDE</button>
        <p class="overlay-foot">H toggles this card · P opens the tuning panel · R resets</p>
      </div>
    `;
    this.deviceLine = this.root.querySelector('[data-el="device"]')!;
    this.tableBody = this.root.querySelector('[data-el="tableBody"]')!;
    this.padHeader = this.root.querySelector('[data-el="padHeader"]')!;
    this.setFamily('generic');
    for (const el of this.root.querySelectorAll<HTMLElement>('.bike')) {
      el.addEventListener('click', () => this.pick(el.dataset.bike as BikeId));
    }
    this.markSelection();
    this.root.querySelector('[data-el="go"]')!.addEventListener('click', () => this.hide());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  /** Renders the button names for whichever pad is actually in use. */
  /** Called when a bike card is chosen. */
  onBikePicked(fn: (id: BikeId) => void): void {
    this.onPick = fn;
  }

  private pick(id: BikeId): void {
    if (!id || id === this.selected) return;
    this.selected = id;
    this.markSelection();
    this.onPick?.(id);
  }

  private markSelection(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('.bike')) {
      el.classList.toggle('is-on', el.dataset.bike === this.selected);
    }
  }

  setFamily(family: PadFamily): void {
    if (this.family === family) return;
    this.family = family;
    this.padHeader.textContent =
      family === 'xbox' ? 'Xbox' : family === 'playstation' ? 'PS5' : 'Controller';
    this.tableBody.innerHTML = bindingsFor(family)
      .map((b) => `<tr><td>${b.action}</td><td class="pad">${b.pad}</td><td class="key">${b.key}</td></tr>`)
      .join('');
  }

  setDevice(connected: boolean, name: string, family: PadFamily): void {
    this.setFamily(family);
    this.deviceLine.innerHTML = connected
      ? `<b class="ok">${name} connected</b> — full controller layout live.`
      : `No controller detected — <b>keyboard</b> map below. Plug a controller in and press a button.`;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('is-hidden');
    this.onDismiss();
  }

  get isVisible(): boolean {
    return this.visible;
  }
}
