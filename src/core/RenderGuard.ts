import * as THREE from 'three';

/**
 * Keeps a GPU failure from presenting as a blank white screen.
 *
 * This exists because of a real Xbox session: the HUD, the sim and the save
 * system were all running - a run had been ridden and banked - over a viewport
 * that drew nothing at all. A WebGL context can be taken away at any moment
 * (the console browser has a hard memory ceiling and will reclaim it under
 * pressure), and with no listener attached the canvas simply stops updating.
 * Everything that isn't the canvas keeps working, which is the most confusing
 * possible failure to debug from a photo of a television.
 *
 * Two rules here:
 *  - `preventDefault()` on `webglcontextlost` is what makes restoration
 *    possible at all. Without it the browser never fires `webglcontextrestored`
 *    and the canvas is dead for the life of the page.
 *  - Whatever happens, say so on screen.
 */

export interface ContextHooks {
  /** Stop simulating; the GPU is gone. */
  onLost(): void;
  /** GPU is back: re-upload anything held in a render target. */
  onRestored(): void;
  /** Human-readable breadcrumb for the diagnostics panel. */
  note(msg: string): void;
}

/**
 * Builds the renderer, turning every way this can fail into one thrown Error
 * with a message worth reading off a TV.
 */
export function createRenderer(antialias: boolean): THREE.WebGLRenderer {
  try {
    const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
    // three.js can hand back a renderer whose context creation quietly failed.
    if (!renderer.getContext()) throw new Error('context was not created');
    return renderer;
  } catch (err) {
    // Only now spend a context working out *why*, so the happy path creates
    // exactly one. A probe on the way in is not free: contexts are a limited
    // resource, and an un-released one makes a tight GPU budget tighter.
    const gpu = probeWebGL();
    const detail = gpu.webgl2
      ? `WebGL2 works, but the renderer would not start: ${message(err)}`
      : gpu.webgl1
        ? 'This browser has WebGL1 but not WebGL2, which the game needs to draw.'
        : 'The graphics processor is not responding — no WebGL context of any kind.';
    throw new RenderStartError(detail, gpu);
  }
}

export interface GpuReport {
  webgl2: boolean;
  webgl1: boolean;
  renderer: string;
}

/** Carries the probe result so the fatal screen can give the right advice. */
export class RenderStartError extends Error {
  constructor(message: string, readonly gpu: GpuReport) {
    super(message);
    this.name = 'RenderStartError';
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Asks what the GPU can actually do, and hands the contexts straight back.
 *
 * `WEBGL_lose_context` is the only way to release a context on demand -
 * dropping the canvas just leaves it to the garbage collector, which on a
 * console with a hard graphics budget is far too late.
 */
export function probeWebGL(): GpuReport {
  const report: GpuReport = { webgl2: false, webgl1: false, renderer: 'unknown' };
  for (const kind of ['webgl2', 'webgl'] as const) {
    type AnyGl = WebGLRenderingContext | WebGL2RenderingContext;
    let gl: AnyGl | null = null;
    try {
      gl = document.createElement('canvas').getContext(kind) as AnyGl | null;
      if (!gl) continue;
      if (kind === 'webgl2') report.webgl2 = true;
      else report.webgl1 = true;
      if (report.renderer === 'unknown') {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        report.renderer = dbg
          ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
          : String(gl.getParameter(gl.RENDERER));
      }
    } catch {
      /* treat any throw as "not available" */
    } finally {
      try {
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        /* nothing else to do */
      }
    }
  }
  return report;
}

/**
 * Waits for the GPU to come back before giving up on it.
 *
 * After a GPU process crash - which is exactly what an out-of-memory kill is -
 * Chromium takes a moment to restart it, and any `getContext` call in that
 * window returns null. Loading the page during that window looked permanent
 * and was not. Retry a few times before declaring it dead.
 */
export async function waitForGpu(attempts = 4, gapMs = 700): Promise<GpuReport> {
  let report = probeWebGL();
  for (let i = 1; i < attempts && !report.webgl2; i++) {
    await new Promise((r) => setTimeout(r, gapMs));
    report = probeWebGL();
  }
  return report;
}

/** Attaches loss/restore handling to a live renderer. */
export function guardContext(renderer: THREE.WebGLRenderer, hooks: ContextHooks): void {
  const canvas = renderer.domElement;

  canvas.addEventListener('webglcontextlost', (e) => {
    // Required: this is the opt-in for ever getting the context back.
    e.preventDefault();
    hooks.note('WebGL context lost - usually GPU memory. Trying to restore.');
    hooks.onLost();
  });

  canvas.addEventListener('webglcontextrestored', () => {
    hooks.note('WebGL context restored.');
    hooks.onRestored();
  });

  // Chromium fires this when the GPU process itself goes down.
  canvas.addEventListener('webglcontextcreationerror', (e) => {
    hooks.note(`WebGL creation error: ${(e as WebGLContextEvent).statusMessage || 'unknown'}`);
  });
}

/**
 * Last resort: the game cannot run, so put the reason on the screen in type big
 * enough to read from a sofa. Anything is better than white.
 */
export function showFatal(
  container: HTMLElement, heading: string, detail: string, gpu?: GpuReport,
): void {
  const panel = document.createElement('div');
  panel.className = 'fatal';

  // If WebGL is simply absent, the fix is almost never in the page - it is a
  // graphics driver or GPU process that has fallen over and needs restarting.
  // Say so in the words of the device it is being read on.
  const dead = gpu ? !gpu.webgl2 && !gpu.webgl1 : false;
  const steps = dead
    ? [
      'Close Edge completely on the Xbox — not just this tab. Press the Xbox '
        + 'button, highlight Edge, press Menu, then Quit.',
      'Open Edge again and reload the game.',
      'If it still will not start, restart the Xbox itself. That resets the '
        + 'graphics chip, which is what has stopped responding.',
    ]
    : ['Reload the page.', 'If it keeps happening, take a photo of this screen.'];

  panel.innerHTML = `
    <h1></h1>
    <p data-el="detail"></p>
    <p class="fatal-gpu" data-el="gpu"></p>
    <ol class="fatal-steps"></ol>
    <button class="fatal-retry" data-el="retry" type="button">Try again</button>`;
  panel.querySelector('h1')!.textContent = heading;
  panel.querySelector('[data-el="detail"]')!.textContent = detail;
  panel.querySelector('[data-el="gpu"]')!.textContent = gpu
    ? `WebGL2 ${gpu.webgl2 ? 'yes' : 'no'} · WebGL1 ${gpu.webgl1 ? 'yes' : 'no'} · ${gpu.renderer}`
    : describeGpu();
  const list = panel.querySelector('.fatal-steps')!;
  for (const step of steps) {
    const li = document.createElement('li');
    li.textContent = step;
    list.appendChild(li);
  }
  panel.querySelector('[data-el="retry"]')!.addEventListener('click', () => {
    location.reload();
  });
  container.appendChild(panel);
  // A controller has no cursor here, so put focus on the button: A activates it.
  (panel.querySelector('[data-el="retry"]') as HTMLButtonElement).focus();
}

/** Renderer string via the debug extension, for the fatal panel and diagnostics. */
export function describeGpu(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'no WebGL context available';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const version = String(gl.getParameter(gl.VERSION));
    return `${name} - ${version}`;
  } catch {
    return 'GPU info unavailable';
  }
}
