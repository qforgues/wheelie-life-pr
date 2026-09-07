import { BINDINGS } from '../input/bindings';
import { BIKE_VISUALS } from '../view/bikeVisuals';
import { BIKES, type BikeId } from '../sim/tuning';
import type { Progress } from '../game/Progress';
import { money, SCANNER_PRICE } from '../game/Progress';
import { TRAFFIC_LABELS, TRAFFIC_ORDER, type TrafficSpeed } from '../world/Traffic';
import { POLICE_BLURBS, POLICE_LABELS, POLICE_ORDER, type PoliceStyle } from '../world/Police';
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
  private cashEl!: HTMLElement;
  private hintEl!: HTMLElement;

  private onDiag: (() => void) | null = null;
  private trafficEl!: HTMLElement;
  private updateBar!: HTMLElement;
  private traffic: TrafficSpeed = 'regular';
  private onTraffic: ((t: TrafficSpeed) => void) | null = null;
  private scannerEl!: HTMLElement;
  private onScanner: (() => void) | null = null;
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

        <div class="garage-head">
          <span class="garage-title">GARAGE</span>
          <span class="garage-cash" data-el="cash">$0</span>
        </div>
        <div class="bike-pick" data-el="bikePick"></div>
        <p class="garage-hint" data-el="garageHint"></p>

        <div class="opt">
          <span class="opt-label">TRAFFIC</span>
          <div class="opt-choices" data-el="traffic"></div>
        </div>
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
        <button class="overlay-go" data-el="go">RIDE</button>
        <div class="upgrade" data-el="scanner"></div>
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
    this.root.querySelector('[data-el="version"]')!.textContent = BUILD_ID;
    // A controller cannot ask the browser for a hard reload, so the game does
    // it: drop every cache and come back on a URL the cache has never seen.
    this.root.querySelector('[data-el="refresh"]')!
      .addEventListener('click', (e) => { e.stopPropagation(); void hardReload(); });
    this.updateBar = this.root.querySelector('[data-el="updateBar"]')!;
    this.root.querySelector('[data-el="update"]')!
      .addEventListener('click', (e) => { e.stopPropagation(); void hardReload(); });

    this.scannerEl = this.root.querySelector('[data-el="scanner"]')!;
    this.scannerEl.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-buy-scanner]')) return;
      e.stopPropagation();
      if (this.progress?.buyScanner()) {
        this.renderGarage();
        this.onScanner?.();
      }
    });

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

  /** Called after the police scanner is bought, so the HUD can update cash. */
  onScannerBought(fn: () => void): void {
    this.onScanner = fn;
  }

  private renderScanner(): void {
    const owned = this.progress?.scanner ?? false;
    const afford = this.progress?.canAfford(SCANNER_PRICE) ?? false;
    this.scannerEl.classList.toggle('is-owned', owned);
    this.scannerEl.innerHTML = `
      <div>
        <b>POLICE SCANNER</b>
        <span>Shows patrols on your GPS while the heat is on.</span>
      </div>
      ${owned
        ? '<span class="owned-tag">OWNED</span>'
        : `<button class="bike-buy" data-buy-scanner type="button" ${afford ? '' : 'disabled'}>
             BUY · ${money(SCANNER_PRICE)}
           </button>`}`;
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
  renderGarage(): void {
    const p = this.progress;
    if (!p || !this.bikePick) return;
    this.cashEl.textContent = money(p.money);
    this.renderScanner();

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

  setDevice(connected: boolean, name: string): void {
    this.deviceLine.innerHTML = connected
      ? `<b class="ok">${name} connected</b> — full layout live.`
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
