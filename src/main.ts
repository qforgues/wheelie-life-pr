import './style.css';
import { Game } from './game/Game';

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

const game = new Game(container);
game.start();

// Handy from the console while tuning.
(window as unknown as { game: Game }).game = game;
