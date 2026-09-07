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
  // three.js dropped WebGL1 in r163, so this is a hard requirement now. Probe
  // for it first: the failure is otherwise an opaque constructor throw, and on
  // a console browser nobody can open devtools to find out which one it was.
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) {
    throw new Error(
      'This browser does not support WebGL2, which the game needs to draw. '
      + `(${describeGpu()})`,
    );
  }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
  } catch (err) {
    throw new Error(`WebGL could not start: ${err instanceof Error ? err.message : String(err)}`);
  }
  // three.js can hand back a renderer whose context creation quietly failed.
  if (!renderer.getContext()) throw new Error('WebGL context was not created.');
  return renderer;
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
export function showFatal(container: HTMLElement, heading: string, detail: string): void {
  const panel = document.createElement('div');
  panel.className = 'fatal';
  const gpu = describeGpu();
  panel.innerHTML = `
    <h1></h1>
    <p data-el="detail"></p>
    <p class="fatal-gpu" data-el="gpu"></p>
    <p class="fatal-hint">Close the tab and open it again. If it keeps happening,
      take a photo of this screen.</p>`;
  panel.querySelector('h1')!.textContent = heading;
  panel.querySelector('[data-el="detail"]')!.textContent = detail;
  panel.querySelector('[data-el="gpu"]')!.textContent = gpu;
  container.appendChild(panel);
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
