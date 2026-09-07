import './style.css';
import { Game } from './game/Game';
import { isXboxDevice } from './input/InputManager';
import { RenderStartError, showFatal, waitForGpu } from './core/RenderGuard';

// TV overscan and couch viewing distance are handled in CSS off this class.
if (isXboxDevice()) document.body.classList.add('is-console');

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

/**
 * Boot.
 *
 * Deliberately async, and deliberately patient. An out-of-memory kill takes the
 * whole GPU process down with it, and Chromium needs a second or two to bring
 * one back; a page loaded inside that window gets `null` from every
 * `getContext` call and used to conclude the console had no WebGL at all. Wait
 * for it before saying anything so final.
 */
async function boot(): Promise<void> {
  const gpu = await waitForGpu();
  if (!gpu.webgl2) {
    showFatal(
      container!,
      'Graphics could not start',
      gpu.webgl1
        ? 'This browser has WebGL1 but not WebGL2, which the game needs to draw.'
        : 'The graphics processor is not responding, so nothing can be drawn yet.',
      gpu,
    );
    return;
  }

  try {
    const game = new Game(container!);
    game.start();
    // Handy from the console while tuning.
    (window as unknown as { game: Game }).game = game;
  } catch (err) {
    console.error(err);
    showFatal(
      container!,
      'Graphics could not start',
      err instanceof Error ? err.message : String(err),
      err instanceof RenderStartError ? err.gpu : gpu,
    );
  }
}

void boot();
