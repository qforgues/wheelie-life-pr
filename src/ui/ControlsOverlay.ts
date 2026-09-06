import { BINDINGS } from '../input/bindings';

/**
 * The keyboard/pad mapping card. Shown on first load, dismissed with H or any
 * throttle input; the whole thing renders from input/bindings.ts so the card can
 * never drift from the actual mapping.
 */
export class ControlsOverlay {
  readonly root: HTMLDivElement;
  private visible = true;
  private deviceLine: HTMLElement;

  constructor(private onDismiss: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="overlay-card">
        <div class="overlay-crown">♛</div>
        <h1>WHEELIE LIFE <span>PR</span></h1>
        <p class="overlay-tag">CALLES ♛ BIKES ♛ ISLA ♛ LIBERTAD</p>
        <p class="overlay-device" data-el="device">Checking for a controller…</p>
        <table class="overlay-table">
          <thead><tr><th>Action</th><th>PS5</th><th>Keyboard</th></tr></thead>
          <tbody>
            ${BINDINGS.map((b) => `
              <tr><td>${b.action}</td><td class="pad">${b.pad}</td><td class="key">${b.key}</td></tr>
            `).join('')}
          </tbody>
        </table>
        <div class="overlay-tips">
          <p><b>To get it up:</b> 1st or 2nd gear, pin the throttle and pull back at the same time.</p>
          <p><b>To hold it:</b> ride the throttle. Too far over? A stab of brake brings the nose down.</p>
          <p><b>Listen.</b> When the tail starts scraping you are one heartbeat from looping it.</p>
        </div>
        <button class="overlay-go" data-el="go">RIDE</button>
        <p class="overlay-foot">H toggles this card · P opens the tuning panel · R resets</p>
      </div>
    `;
    this.deviceLine = this.root.querySelector('[data-el="device"]')!;
    this.root.querySelector('[data-el="go"]')!.addEventListener('click', () => this.hide());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  setDevice(connected: boolean, name: string): void {
    this.deviceLine.innerHTML = connected
      ? `<b class="ok">${name} connected</b> — full PS5 layout live, rumble on.`
      : `No controller detected — <b>keyboard</b> map below. Plug in a DualSense and press a button.`;
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
