import { BINDINGS } from '../input/bindings';
import { BIKE_VISUALS } from '../view/bikeVisuals';
import { BIKES, type BikeId } from '../sim/tuning';
import type { Progress } from '../game/Progress';
import { money } from '../game/Progress';
import { UPGRADES, UPGRADE_IDS, nextLevel, type UpgradeId } from '../game/Upgrades';
import { TRAFFIC_LABELS, TRAFFIC_ORDER, type TrafficSpeed } from '../world/Traffic';
import { POLICE_BLURBS, POLICE_LABELS, POLICE_ORDER, type PoliceStyle } from '../world/Police';
import { RIVAL_BLURBS, RIVAL_LABELS, RIVAL_ORDER, type RivalCount } from '../world/Rivals';
import { OUTFITS, OUTFIT_IDS, STARTER_OUTFIT, WIN_ONLY, type OutfitId } from '../game/Outfits';
import {
  ORIENTATION_BLURBS, ORIENTATION_LABELS, ORIENTATION_ORDER, type MapOrientation,
} from './Minimap';
import {
  DEFAULT_AIM, MOUNT_BLURBS, MOUNT_LABELS, MOUNT_ORDER,
  type MirrorAim, type MirrorMount,
} from '../view/Mirrors';

/**
 * La monoestrellada, inline.
 *
 * Five stripes, a blue triangle on the hoist and one white star. Drawn rather
 * than fetched: an external image would be one more thing that can fail to load
 * on a console, and this is three shapes.
 */
const PR_FLAG = `
  <svg class="overlay-flag" viewBox="0 0 30 20" role="img" aria-label="Puerto Rico">
    <rect width="30" height="20" fill="#ed1c24"/>
    <rect y="4" width="30" height="4" fill="#fff"/>
    <rect y="12" width="30" height="4" fill="#fff"/>
    <path d="M0 0 L17 10 L0 20 Z" fill="#0050f0"/>
    <path fill="#fff" d="M5.9 6.4 L7 9.6 L10.3 9.6 L7.6 11.6 L8.7 14.8 L5.9 12.8
      L3.1 14.8 L4.2 11.6 L1.5 9.6 L4.8 9.6 Z"/>
  </svg>`;

/**
 * The handling numbers, read straight off each bike's tuning.
 *
 * These used to be invisible - the bikes genuinely steer and lean differently
 * and there was no way to know that before buying one. Derived rather than
 * written down, so a bar can never disagree with how the bike actually rides.
 */
function statBars(id: BikeId): string {
  const t = BIKES[id];
  // Steady-state lean is authority over restoring force; turn-in is the
  // low-speed yaw rate. Both normalised across the three bikes we have.
  const leanDeg = (t.balance.rollAuthority / t.balance.rollResponse) * (180 / Math.PI);
  const rows: Array<[string, number, string]> = [
    ['LEAN', (leanDeg - 28) / 14, `${leanDeg.toFixed(0)}°`],
    ['TURN', (t.steering.maxYawRateLow - 1.4) / 0.8, ''],
    ['POWER', (t.engine.peakTorque - 15) / 115, `${t.engine.peakTorque} N·m`],
    ['GEARS', (t.gearbox.gearRatios.length - 4) / 2, `${t.gearbox.gearRatios.length}-spd`],
  ];
  return `<span class="bike-stats">${rows.map(([label, v, note]) => {
    const pct = Math.round(Math.max(0.08, Math.min(1, v)) * 100);
    return `<span class="stat">
        <b>${label}</b>
        <i><u style="width:${pct}%"></u></i>
        <em>${note}</em>
      </span>`;
  }).join('')}</span>`;
}

const clampAim = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 100) / 100));
import { BUILD_ID } from '../core/version';
import { hardReload } from '../core/UpdateWatcher';

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

  private selected: BikeId = 'grom';
  private onPick: ((id: BikeId) => void) | null = null;
  private progress: Progress | null = null;
  private bikePick!: HTMLElement;
  private outfitPick!: HTMLElement;
  private tabsEl!: HTMLElement;
  /** Which half of the wardrobe is showing. Justin's two buttons. */
  private tab: 'garage' | 'closet' = 'garage';
  private selectedOutfit: OutfitId = STARTER_OUTFIT;
  private onOutfit: ((id: OutfitId) => void) | null = null;
  private cashEl!: HTMLElement;
  private hintEl!: HTMLElement;

  private onDiag: (() => void) | null = null;
  private trafficEl!: HTMLElement;
  private updateBar!: HTMLElement;
  private traffic: TrafficSpeed = 'regular';
  private onTraffic: ((t: TrafficSpeed) => void) | null = null;
  private tuneshopEl!: HTMLElement;
  private onUpgrade: (() => void) | null = null;
  private rivalsEl!: HTMLElement;
  private rivalsBlurbEl!: HTMLElement;
  private rivals: RivalCount = 'few';
  private onRivals: ((r: RivalCount) => void) | null = null;

  private policeEl!: HTMLElement;
  private policeBlurbEl!: HTMLElement;
  private police: PoliceStyle = 'professional';
  private onPolice: ((p: PoliceStyle) => void) | null = null;
  private mirrorEl!: HTMLElement;
  private mirrorBlurbEl!: HTMLElement;
  private aimEl!: HTMLElement;
  private mirrors: MirrorMount = 'corners';
  private aim: MirrorAim = { ...DEFAULT_AIM };
  private aimSide: 'L' | 'R' = 'L';
  private peekTimer = 0;
  private onMirrors: ((m: MirrorMount) => void) | null = null;
  private onAim: ((aim: MirrorAim) => void) | null = null;
  private gpsEl!: HTMLElement;
  private gpsBlurbEl!: HTMLElement;
  private orientation: MapOrientation = 'north';
  private onOrientation: ((o: MapOrientation) => void) | null = null;

  constructor(private onDismiss: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="overlay-card">
        <h1>WHEELIE LIFE <span>PR</span>${PR_FLAG}</h1>
        <p class="overlay-tag">CALLES ♛ BIKES ♛ ISLA ♛ LIBERTAD</p>
        <p class="overlay-device" data-el="device">Checking for a controller…</p>
        <button class="overlay-go" data-el="go">RIDE</button>

        <div class="garage-head">
          <div class="garage-tabs" data-el="tabs">
            <button type="button" data-tab="garage" class="tab is-on">GARAGE</button>
            <button type="button" data-tab="closet" class="tab">CLOSET</button>
          </div>
          <span class="garage-cash" data-el="cash">$0</span>
        </div>
        <div class="bike-pick" data-el="bikePick"></div>
        <div class="bike-pick" data-el="outfitPick" hidden></div>
        <p class="garage-hint" data-el="garageHint"></p>

        <div class="opt">
          <span class="opt-label">TRAFFIC</span>
          <div class="opt-choices" data-el="traffic"></div>
        </div>
        <div class="opt">
          <span class="opt-label">RIVALS</span>
          <div class="opt-choices" data-el="rivals"></div>
        </div>
        <p class="opt-blurb" data-el="rivalsBlurb"></p>
        <div class="opt">
          <span class="opt-label">POLICÍA</span>
          <div class="opt-choices" data-el="police"></div>
        </div>
        <p class="opt-blurb" data-el="policeBlurb"></p>
        <div class="opt">
          <span class="opt-label">GPS</span>
          <div class="opt-choices" data-el="gps"></div>
        </div>
        <p class="opt-blurb" data-el="gpsBlurb"></p>
        <div class="opt">
          <span class="opt-label">MIRRORS</span>
          <div class="opt-choices" data-el="mirrors"></div>
          <div class="aim" data-el="aim">
            <div class="aim-side">
              <button type="button" data-side="L" class="is-on">L</button>
              <button type="button" data-side="R">R</button>
            </div>
            <div class="aim-pad">
              <button type="button" data-aim="0,1" title="Up">▲</button>
              <button type="button" data-aim="-1,0" title="Left">◀</button>
              <button type="button" data-aim="0,0" title="Centre">●</button>
              <button type="button" data-aim="1,0" title="Right">▶</button>
              <button type="button" data-aim="0,-1" title="Down">▼</button>
            </div>
          </div>
        </div>
        <p class="opt-blurb" data-el="mirrorBlurb"></p>
        <div class="tuneshop" data-el="tuneshop"></div>
        <table class="overlay-table">
          <thead><tr><th>Action</th><th>Xbox</th><th>Keyboard</th></tr></thead>
          <tbody data-el="tableBody"></tbody>
        </table>
        <div class="overlay-tips">
          <p><b>To get it up:</b> low gear, pin the throttle and pull back at the same time.</p>
          <p><b>To hold it:</b> ride the throttle. Too far over? A stab of brake brings the nose down.</p>
          <p><b>Listen.</b> When the tail starts scraping you are one heartbeat from looping it.</p>
          <p><b>La policía:</b> they only care about wheelies. Heat climbs while the front wheel is up and cools when you ride clean — you get one warning first. Keep moving and they will not catch you.</p>
          <p><b>Tricks:</b> once the front is up, hold a trick button to get a knee on the seat or stand right up. Standing scores most and is hardest to hold.</p>
        </div>
        <div class="update-bar" data-el="updateBar" hidden>
          <span>A newer version is ready. You can keep riding this one.</span>
          <button class="update-go" data-el="update" type="button">UPDATE NOW</button>
        </div>

        <p class="overlay-foot">
          <b>View</b> opens this menu any time · D-pad up shows diagnostics · Menu resets the bike
          <br>On a keyboard: H · D · P for the tuning panel · R to reset
        </p>
        <p class="overlay-version">
          VERSION <b data-el="version"></b>
          <button class="overlay-diag" data-el="diag" type="button">Diagnostics</button>
          <button class="overlay-refresh" data-el="refresh" type="button">Force refresh</button>
        </p>
      </div>
    `;
    this.deviceLine = this.root.querySelector('[data-el="device"]')!;
    this.tableBody = this.root.querySelector('[data-el="tableBody"]')!;
    this.tableBody.innerHTML = BINDINGS
      .map((b) => `<tr><td>${b.action}</td><td class="pad">${b.pad}</td><td class="key">${b.key}</td></tr>`)
      .join('');
    this.bikePick = this.root.querySelector('[data-el="bikePick"]')!;
    this.outfitPick = this.root.querySelector('[data-el="outfitPick"]')!;
    this.tabsEl = this.root.querySelector('[data-el="tabs"]')!;
    this.tabsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab as 'garage' | 'closet';
      this.renderGarage();
    });
    this.outfitPick.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-outfit]');
      if (!card) return;
      const id = card.dataset.outfit as OutfitId;
      const p = this.progress;
      if (!p) return;
      if ((e.target as HTMLElement).closest('[data-buy-kit]')) {
        p.buyOutfit(id);
      }
      this.selectedOutfit = id;
      if (p.hasOutfit(id)) {
        p.wear(id);
        this.onOutfit?.(id);
      }
      this.renderGarage();
    });
    this.cashEl = this.root.querySelector('[data-el="cash"]')!;
    this.hintEl = this.root.querySelector('[data-el="garageHint"]')!;
    this.bikePick.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.bike');
      if (!card) return;
      const id = card.dataset.bike as BikeId;
      if ((e.target as HTMLElement).closest('[data-buy]')) this.tryBuy(id);
      else this.pick(id);
    });
    // The card is a div now, so it needs its own keyboard activation.
    this.bikePick.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = (e.target as HTMLElement).closest<HTMLElement>('.bike');
      if (!card || (e.target as HTMLElement).closest('[data-buy]')) return;
      e.preventDefault();
      this.pick(card.dataset.bike as BikeId);
    });
    const versionEl = this.root.querySelector<HTMLElement>('[data-el="version"]')!;
    versionEl.textContent = BUILD_ID;

    // Then correct it from the server.
    //
    // BUILD_ID is baked in when the bundle is compiled, and on a dev server
    // that happens once, at startup - so it goes on reporting whatever commit
    // the server was launched at no matter how much has changed since. Two
    // separate sessions were lost to "I hard refreshed and the version did not
    // move". What the SERVER says it has is the only number worth showing.
    void fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { build?: unknown } | null) => {
        if (!d || typeof d.build !== 'string') return;
        versionEl.textContent = d.build;
        if (d.build.includes('+dev.')) versionEl.classList.add('is-dev');
        // Bundle older than what the server holds: say so rather than let the
        // number quietly disagree with the code that is running.
        if (d.build !== BUILD_ID) {
          versionEl.classList.add('is-stale');
          versionEl.title = `page is running ${BUILD_ID}`;
        }
      })
      .catch(() => { /* no manifest, e.g. a bare dev server - keep the baked id */ });

    if (BUILD_ID.includes('+dev.')) versionEl.classList.add('is-dev');
    // A controller cannot ask the browser for a hard reload, so the game does
    // it: drop every cache and come back on a URL the cache has never seen.
    this.root.querySelector('[data-el="refresh"]')!
      .addEventListener('click', (e) => { e.stopPropagation(); void hardReload(); });
    this.updateBar = this.root.querySelector('[data-el="updateBar"]')!;
    this.root.querySelector('[data-el="update"]')!
      .addEventListener('click', (e) => { e.stopPropagation(); void hardReload(); });

    this.tuneshopEl = this.root.querySelector('[data-el="tuneshop"]')!;
    this.tuneshopEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-upgrade]');
      if (!b || !this.progress) return;
      e.stopPropagation();
      if (this.progress.buyUpgrade(this.selected, b.dataset.upgrade as UpgradeId)) {
        this.renderGarage();
        this.onUpgrade?.();
      }
    });


    this.rivalsEl = this.root.querySelector('[data-el="rivals"]')!;
    this.rivalsBlurbEl = this.root.querySelector('[data-el="rivalsBlurb"]')!;
    this.rivalsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rivals]');
      if (!b) return;
      this.setRivals(b.dataset.rivals as RivalCount);
    });
    this.renderRivals();

    this.policeEl = this.root.querySelector('[data-el="police"]')!;
    this.policeBlurbEl = this.root.querySelector('[data-el="policeBlurb"]')!;
    this.policeEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-police]');
      if (!b) return;
      e.stopPropagation();
      this.setPolice(b.dataset.police as PoliceStyle);
    });
    this.renderPolice();

    this.gpsEl = this.root.querySelector('[data-el="gps"]')!;
    this.gpsBlurbEl = this.root.querySelector('[data-el="gpsBlurb"]')!;
    this.gpsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-gps]');
      if (!b) return;
      e.stopPropagation();
      this.orientation = b.dataset.gps as MapOrientation;
      this.renderGps();
      this.onOrientation?.(this.orientation);
    });
    this.renderGps();

    this.mirrorEl = this.root.querySelector('[data-el="mirrors"]')!;
    this.mirrorBlurbEl = this.root.querySelector('[data-el="mirrorBlurb"]')!;
    this.aimEl = this.root.querySelector('[data-el="aim"]')!;
    this.mirrorEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mirrors]');
      if (!b) return;
      e.stopPropagation();
      this.mirrors = b.dataset.mirrors as MirrorMount;
      this.renderMirrors();
      this.onMirrors?.(this.mirrors);
    });
    this.aimEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Which mirror the pad is driving.
      const sideBtn = target.closest<HTMLElement>('[data-side]');
      if (sideBtn) {
        e.stopPropagation();
        this.aimSide = sideBtn.dataset.side as 'L' | 'R';
        this.aimEl.querySelectorAll('[data-side]').forEach((b) => {
          b.classList.toggle('is-on', (b as HTMLElement).dataset.side === this.aimSide);
        });
        return;
      }

      const b = target.closest<HTMLElement>('[data-aim]');
      if (!b) return;
      e.stopPropagation();
      const [dx, dy] = b.dataset.aim!.split(',').map(Number);
      const xKey = this.aimSide === 'L' ? 'lx' : 'rx';
      const yKey = this.aimSide === 'L' ? 'ly' : 'ry';
      // The centre button resets only the mirror you are holding.
      if (dx === 0 && dy === 0) { this.aim[xKey] = 0; this.aim[yKey] = 0; }
      else {
        this.aim[xKey] = clampAim(this.aim[xKey] + dx * 0.14);
        this.aim[yKey] = clampAim(this.aim[yKey] + dy * 0.14);
      }
      this.onAim?.({ ...this.aim });
      this.peekAtMirrors();
    });
    this.renderMirrors();

    this.trafficEl = this.root.querySelector('[data-el="traffic"]')!;
    this.trafficEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-traffic]');
      if (!b) return;
      e.stopPropagation();
      this.setTraffic(b.dataset.traffic as TrafficSpeed);
    });
    this.renderTraffic();

    this.root.querySelector('[data-el="go"]')!.addEventListener('click', () => this.hide());
    this.root.querySelector('[data-el="diag"]')!
      .addEventListener('click', (e) => { e.stopPropagation(); this.onDiag?.(); });
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  /** Wires the card's Diagnostics button, which is the only way to reach the
   *  readout on a console without remembering the D-pad shortcut. */
  onDiagnostics(fn: () => void): void {
    this.onDiag = fn;
  }

  /** Called after an upgrade is bought, so the bike can pick it up at once. */
  onUpgradeBought(fn: () => void): void {
    this.onUpgrade = fn;
  }

  /**
   * The tuning shop for whichever bike is selected.
   *
   * Deliberately sits under the garage rather than behind another screen: the
   * point of upgrades is that you can see what your money would do to the bike
   * you are looking at.
   */
  private renderTuneshop(): void {
    const p = this.progress;
    if (!p) return;
    if (!p.has(this.selected)) {
      this.tuneshopEl.innerHTML = '';
      this.tuneshopEl.hidden = true;
      return;
    }
    this.tuneshopEl.hidden = false;
    const invested = p.investedIn(this.selected);
    const bike = BIKE_VISUALS[this.selected].displayName;

    this.tuneshopEl.innerHTML = `
      <div class="tuneshop-head">
        <span class="opt-label">UPGRADES · ${bike}</span>
        ${invested > 0 ? `<span class="tuneshop-spent">${money(invested)} fitted</span>` : ''}
      </div>
      <div class="tuneshop-grid">
        ${UPGRADE_IDS.map((id) => {
          const kind = UPGRADES[id];
          const owned = p.levelOf(this.selected, id);
          const next = nextLevel(id, owned);
          const pips = kind.levels
            .map((_, i) => `<i class="${i < owned ? 'is-on' : ''}"></i>`).join('');
          const action = !next
            ? '<span class="tuneshop-max">MAXED</span>'
            : p.canAfford(next.price)
              ? `<button class="bike-buy" data-upgrade="${id}" type="button">${money(next.price)}</button>`
              : `<span class="bike-price">${money(next.price)}</span>`;
          return `
            <div class="tunepart${next ? '' : ' is-max'}">
              <div class="tunepart-top">
                <b>${kind.name}</b>
                <span class="pips">${pips}</span>
              </div>
              <span class="scope-pill ${kind.scope}">
                ${kind.scope === 'bike' ? 'TUNING' : 'GEAR'}
              </span>
              <span class="tunepart-blurb">${next ? next.blurb : kind.summary}</span>
              <div class="tunepart-foot">${action}</div>
            </div>`;
        }).join('')}
      </div>`;
  }



  /** Called when the mirror mount changes. */
  onMirrorsPicked(fn: (m: MirrorMount) => void): void {
    this.onMirrors = fn;
  }

  /** Called when the rider trims the mirrors. */
  onMirrorAim(fn: (aim: MirrorAim) => void): void {
    this.onAim = fn;
  }

  setMirrorValues(mount: MirrorMount, aim: MirrorAim): void {
    this.mirrors = mount;
    this.aim = { ...aim };
    this.renderMirrors();
  }

  /**
   * Fades the card down for a moment so the mirrors behind it are visible.
   *
   * Aiming a mirror you cannot see is guesswork, and the card covers exactly
   * the corners the mirrors live in. The controls stay clickable throughout -
   * only the opacity changes - so you can keep nudging and watch it move.
   */
  private peekAtMirrors(): void {
    this.root.classList.add('is-peeking');
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => {
      this.root.classList.remove('is-peeking');
    }, 1600) as unknown as number;
  }

  private renderMirrors(): void {
    this.mirrorEl.innerHTML = MOUNT_ORDER
      .map((mnt) => `<button type="button" data-mirrors="${mnt}"
             class="opt-btn${mnt === this.mirrors ? ' is-on' : ''}"
             aria-pressed="${mnt === this.mirrors}">${MOUNT_LABELS[mnt]}</button>`)
      .join('');
    this.mirrorBlurbEl.textContent = MOUNT_BLURBS[this.mirrors];
    // Aiming only makes sense once they are off the corners: in the corners
    // there is nowhere to move them to.
    this.aimEl.hidden = this.mirrors !== 'bike';
  }

  /** Called when the GPS orientation changes. */
  onOrientationPicked(fn: (o: MapOrientation) => void): void {
    this.onOrientation = fn;
  }

  setOrientationValue(o: MapOrientation): void {
    this.orientation = o;
    this.renderGps();
  }

  private renderGps(): void {
    this.gpsEl.innerHTML = ORIENTATION_ORDER
      .map((o) => `<button type="button" data-gps="${o}"
             class="opt-btn${o === this.orientation ? ' is-on' : ''}"
             aria-pressed="${o === this.orientation}">${ORIENTATION_LABELS[o]}</button>`)
      .join('');
    this.gpsBlurbEl.textContent = ORIENTATION_BLURBS[this.orientation];
  }

  /** Called when the number of other riders changes. */
  onRivalsPicked(fn: (r: RivalCount) => void): void {
    this.onRivals = fn;
  }

  setRivalsValue(r: RivalCount): void {
    this.rivals = r;
    this.renderRivals();
  }

  private setRivals(r: RivalCount): void {
    this.rivals = r;
    this.renderRivals();
    this.onRivals?.(r);
  }

  private renderRivals(): void {
    this.rivalsEl.innerHTML = RIVAL_ORDER
      .map((r) => `<button type="button" data-rivals="${r}"
             class="opt-btn${r === this.rivals ? ' is-on' : ''}"
             aria-pressed="${r === this.rivals}">${RIVAL_LABELS[r]}</button>`)
      .join('');
    this.rivalsBlurbEl.textContent = RIVAL_BLURBS[this.rivals];
  }

  /** Called when the police difficulty changes. */
  onPolicePicked(fn: (p: PoliceStyle) => void): void {
    this.onPolice = fn;
  }

  /** Sets the toggle without firing the callback, for restoring a saved value. */
  setPoliceValue(p: PoliceStyle): void {
    this.police = p;
    this.renderPolice();
  }

  private setPolice(p: PoliceStyle): void {
    this.police = p;
    this.renderPolice();
    this.onPolice?.(p);
  }

  private renderPolice(): void {
    this.policeEl.innerHTML = POLICE_ORDER
      .map((p) => `<button type="button" data-police="${p}"
             class="opt-btn${p === this.police ? ' is-on' : ''}${p === 'ice' ? ' is-ice' : ''}"
             aria-pressed="${p === this.police}">${POLICE_LABELS[p]}</button>`)
      .join('');
    this.policeBlurbEl.textContent = POLICE_BLURBS[this.police];
  }

  /** Called when the traffic setting changes. */
  onTrafficPicked(fn: (t: TrafficSpeed) => void): void {
    this.onTraffic = fn;
  }

  /** Sets the toggle without firing the callback, for restoring a saved value. */
  setTrafficValue(t: TrafficSpeed): void {
    this.traffic = t;
    this.renderTraffic();
  }

  private setTraffic(t: TrafficSpeed): void {
    this.traffic = t;
    this.renderTraffic();
    this.onTraffic?.(t);
  }

  private renderTraffic(): void {
    this.trafficEl.innerHTML = TRAFFIC_ORDER
      .map((t) => `<button type="button" data-traffic="${t}"
             class="opt-btn${t === this.traffic ? ' is-on' : ''}"
             aria-pressed="${t === this.traffic}">${TRAFFIC_LABELS[t]}</button>`)
      .join('');
  }

  /** Raises the update banner on the menu. Never reloads on its own. */
  showUpdate(): void {
    this.updateBar.hidden = false;
  }

  /** Called when a bike card is chosen. */
  onBikePicked(fn: (id: BikeId) => void): void {
    this.onPick = fn;
  }

  /** Hands the garage the wallet. Call once, before the card is shown. */
  attachProgress(p: Progress, selected: BikeId): void {
    this.progress = p;
    this.selected = selected;
    this.renderGarage();
  }

  private pick(id: BikeId): void {
    if (!id) return;
    // You can look at a bike you don't own; you just can't ride it.
    if (!this.progress?.has(id)) {
      this.selected = id;
      this.renderGarage();
      return;
    }
    if (id === this.selected) return;
    this.selected = id;
    this.renderGarage();
    this.onPick?.(id);
  }

  private tryBuy(id: BikeId): void {
    const p = this.progress;
    if (!p) return;
    const price = BIKE_VISUALS[id].price;
    if (!p.buy(id, price)) return;
    this.selected = id;
    this.renderGarage();
    this.onPick?.(id);
  }

  /** Redraws the cards from what's owned and what's affordable. */
  /** Called when the player puts a different outfit on. */
  onOutfitPicked(fn: (id: OutfitId) => void): void {
    this.onOutfit = fn;
  }

  renderGarage(): void {
    const p = this.progress;
    if (!p || !this.bikePick) return;
    // innerHTML, because aura rides alongside the money as its own chip.
    this.cashEl.innerHTML = p.aura > 0
      ? `${money(p.money)}<span class="aura">${p.aura} AURA</span>`
      : money(p.money);
    this.renderTuneshop();

    // One set of cards at a time. Justin's spec: two buttons that split the
    // difference, and whichever you press the other list goes away.
    const closet = this.tab === 'closet';
    for (const b of this.tabsEl.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.classList.toggle('is-on', b.dataset.tab === this.tab);
    }
    this.bikePick.hidden = closet;
    this.outfitPick.hidden = !closet;
    if (closet) {
      this.selectedOutfit = p.wearing;
      this.renderCloset();
      return;
    }

    this.bikePick.innerHTML = (Object.keys(BIKES) as BikeId[]).map((id) => {
      const v = BIKE_VISUALS[id];
      const owned = p.has(id);
      const afford = p.canAfford(v.price);
      const paint = v.bodyColor.toString(16).padStart(6, '0');
      const status = owned
        ? '<span class="bike-owned">OWNED</span>'
        : afford
          ? `<button class="bike-buy" data-buy type="button">BUY · ${money(v.price)}</button>`
          : `<span class="bike-price">${money(v.price)}</span>`;
      // A div, not a button. The card contains a BUY button, and a button
      // inside a button is invalid HTML - the parser closes the outer one and
      // hoists the inner out as a sibling, which turned BUY into its own grid
      // cell and wrapped the third bike onto a second row.
      return `
        <div class="bike${this.selected === id ? ' is-on' : ''}${owned ? '' : ' is-locked'}"
             data-bike="${id}" role="button" tabindex="0"
             aria-pressed="${this.selected === id}">
          <span class="bike-swatch" style="--paint:#${paint}"></span>
          <span class="bike-name">${v.displayName}</span>
          <span class="bike-tag">${v.tagline}</span>
          <span class="bike-char">${v.character}</span>
          ${statBars(id)}
          <span class="bike-foot">${status}</span>
        </div>`;
    }).join('');

    const sel = BIKE_VISUALS[this.selected];
    if (p.has(this.selected)) {
      this.hintEl.textContent = '';
    } else {
      const short = sel.price - p.money;
      this.hintEl.textContent = p.canAfford(sel.price)
        ? `Press BUY to unlock the ${sel.displayName}.`
        : `${money(short)} more to unlock the ${sel.displayName}. Land wheelies to earn it — tricks pay more.`;
    }
  }

  /**
   * The closet.
   *
   * The important line here is the one on gear you have not got: **won, never
   * bought**. Somebody has to lose it to you across a wheelie battle, and that
   * is the whole reason the battles exist - so the card has to say so rather
   * than showing a price that does not exist.
   */
  private renderCloset(): void {
    const p = this.progress;
    if (!p) return;
    this.outfitPick.innerHTML = OUTFIT_IDS.map((id) => {
      const kit = OUTFITS[id];
      const owned = p.hasOutfit(id);
      const worn = p.wearing === id;
      const jersey = kit.jersey.toString(16).padStart(6, '0');
      const helmet = (kit.helmet || kit.sleeve).toString(16).padStart(6, '0');
      const status = worn
        ? '<span class="bike-owned">WEARING</span>'
        : owned
          ? '<span class="bike-owned">IN THE CLOSET</span>'
          : kit.price === WIN_ONLY
            ? '<span class="bike-price is-locked-kit">WIN IT — NOT FOR SALE</span>'
            : p.canAfford(kit.price)
              ? `<button class="bike-buy" data-buy-kit type="button">BUY · ${money(kit.price)}</button>`
              : `<span class="bike-price">${money(kit.price)}</span>`;
      return `
        <div class="bike${worn ? ' is-on' : ''}${owned ? '' : ' is-locked'}"
             data-outfit="${id}" role="button" tabindex="0" aria-pressed="${worn}">
          <span class="bike-swatch kit-swatch" style="--paint:#${jersey};--trim:#${helmet}"></span>
          <span class="bike-name">${kit.name}</span>
          <span class="bike-tag">${kit.tagline}</span>
          <span class="bike-char">${kit.character}</span>
          <span class="bike-foot">${status}</span>
        </div>`;
    }).join('');

    const kit = OUTFITS[this.selectedOutfit];
    this.hintEl.textContent = p.hasOutfit(this.selectedOutfit)
      ? ''
      : kit.price === WIN_ONLY
        ? `The ${kit.name} kit cannot be bought. Ride into one of Los Piratas, put something up, and take it off them.`
        : `${money(Math.max(0, kit.price - p.money))} more for the ${kit.name}.`;
  }

  setDevice(connected: boolean, name: string): void {
    this.deviceLine.innerHTML = connected
      ? `<b class="ok">${name}</b> connected`
      : `No controller — using <b>keyboard</b>. Plug one in and press a button.`;
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
