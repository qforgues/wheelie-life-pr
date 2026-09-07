import type { InputManager } from '../input/InputManager';
import { isXboxDevice } from '../input/InputManager';

/**
 * On-screen environment readout.
 *
 * The console is a device the author cannot open a devtools window on, so if
 * something goes wrong there the only way to find out what is to put it on the
 * screen. This shows what the page actually got: renderer, gamepad, emulation
 * mode, audio state, and live stick and trigger values so a mis-mapped button
 * is visible rather than guessed at.
 */
export class Diagnostics {
  readonly root: HTMLDivElement;
  private body: HTMLElement;
  private visible = false;
  private timer = 0;
  private errors: string[] = [];

  constructor(
    private input: InputManager,
    private info: () => {
      fps: number;
      quality: string;
      drawCalls: number;
      triangles: number;
      audio: string;
      voice: string;
      bike: string;
    },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'diag';
    this.root.innerHTML = '<div class="diag-title">DIAGNOSTICS</div><div data-el="body"></div>';
    this.body = this.root.querySelector('[data-el="body"]')!;
    this.root.style.display = 'none';

    // Anything that throws before or during play lands here, where it can be
    // read off the TV.
    addEventListener('error', (e) => this.note(`${e.message} @ ${shortSrc(e.filename)}:${e.lineno}`));
    addEventListener('unhandledrejection', (e) => this.note(`unhandled: ${String(e.reason).slice(0, 120)}`));
  }

  /** Record a breadcrumb and force the panel open. Public so the render guard
   *  can report a lost GPU context, which throws no error of its own. */
  note(msg: string): void {
    this.errors.unshift(msg);
    this.errors.length = Math.min(this.errors.length, 4);
    // An error is exactly when you want this on screen.
    this.show();
    // Paint the messages right now. `update` may never run again - it is driven
    // by the render loop, and the reason for the note may be that the loop is
    // gone - so the panel must not depend on it to say anything at all.
    this.timer = 0;
    if (!this.body.innerHTML) this.body.innerHTML = row(this.errorRows());
  }

  private errorRows(): Array<[string, string]> {
    return this.errors.map((e, n) => [n === 0 ? 'errors' : '', e] as [string, string]);
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }
  show(): void {
    this.visible = true;
    this.root.style.display = '';
  }
  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }
  get isVisible(): boolean {
    return this.visible;
  }

  update(dt: number, renderer: { getContext(): WebGLRenderingContext | WebGL2RenderingContext }): void {
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;

    const pad = this.input.rawPad();
    const i = this.info();
    const gl = renderer.getContext();
    // Every one of these returns null once the context is lost, which is
    // exactly when this panel matters most.
    const lost = gl.isContextLost();
    let gpu = 'hidden';
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 46);
    } catch {
      gpu = 'unavailable';
    }
    if (lost) gpu = 'CONTEXT LOST';

    const trig = (n: number) => (pad?.buttons[n]?.value ?? 0).toFixed(2);
    const ax = (n: number) => (pad?.axes[n] ?? 0).toFixed(2);
    const pressed = pad
      ? pad.buttons.map((b, n) => (b.pressed ? n : -1)).filter((n) => n >= 0).join(' ') || '—'
      : '—';

    this.body.innerHTML = row([
      ['device', isXboxDevice() ? 'Xbox console browser' : 'desktop / other'],
      ['renderer', `${gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'} · ${gpu}`],
      ...(lost ? [['GPU', 'context lost - waiting for the browser to give it back'] as [string, string]] : []),
      ['screen', `${innerWidth}×${innerHeight} @ ${devicePixelRatio.toFixed(2)}x`],
      ['fps', `${i.fps.toFixed(0)}  ·  quality ${i.quality}`],
      ['scene', `${i.drawCalls} calls · ${(i.triangles / 1000).toFixed(0)}k tris`],
      ['bike', i.bike],
      ['audio', i.audio],
      ['voice', i.voice],
      ['pad input mode', this.input.emulation],
      ['pad', pad ? `${pad.id.slice(0, 40)} (${pad.buttons.length}b/${pad.axes.length}a)` : 'none detected'],
      ['RT / LT', `${trig(7)} / ${trig(6)}`],
      ['left stick', `${ax(0)}, ${ax(1)}`],
      ['right stick', `${ax(2)}, ${ax(3)}`],
      ['buttons down', pressed],
      ...this.errorRows(),
    ]);
  }
}

function row(pairs: Array<[string, string]>): string {
  return pairs
    .map(([k, v]) => `<div class="diag-row"><span>${k}</span><b>${escapeHtml(v)}</b></div>`)
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

function shortSrc(url: string): string {
  return (url || '').split('/').pop() || 'page';
}
