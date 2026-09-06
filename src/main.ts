import './style.css';
import { Game } from './game/Game';
import { isXboxDevice } from './input/InputManager';

// TV overscan and couch viewing distance are handled in CSS off this class.
if (isXboxDevice()) document.body.classList.add('is-console');

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

const game = new Game(container);
game.start();

// Handy from the console while tuning.
(window as unknown as { game: Game }).game = game;
