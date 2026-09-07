import './style.css';
import { Game } from './game/Game';
import { isXboxDevice } from './input/InputManager';
import { showFatal } from './core/RenderGuard';

// TV overscan and couch viewing distance are handled in CSS off this class.
if (isXboxDevice()) document.body.classList.add('is-console');

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

// If the game cannot start at all - no WebGL, no GPU memory - the old
// behaviour was a white rectangle with no explanation, which is what the Xbox
// showed. Anything that escapes construction now goes on the screen instead.
let game: Game;
try {
  game = new Game(container);
  game.start();
} catch (err) {
  console.error(err);
  showFatal(
    container,
    'Graphics could not start',
    err instanceof Error ? err.message : String(err),
  );
  throw err;
}

// Handy from the console while tuning.
(window as unknown as { game: Game }).game = game;
