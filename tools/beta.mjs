/**
 * Starts the beta server, and keeps it started.
 *
 * `npm run beta` used to be `vite preview` in the foreground, which meant it
 * died whenever the shell that launched it went away - including every time a
 * deploy stopped it to avoid serving a half-written build. Twice that left
 * Quentin with a dead localhost tab and no clue why.
 *
 * So: if something is already serving 4173, say so and stop. If nothing is,
 * take it over and stay up. Either way the port ends up serving the game, which
 * is the only thing the caller actually wanted.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const PORT = 4173;

function inUse() {
  return new Promise((resolve) => {
    const probe = createConnection({ port: PORT, host: '127.0.0.1' });
    probe.on('connect', () => { probe.destroy(); resolve(true); });
    probe.on('error', () => resolve(false));
    setTimeout(() => { probe.destroy(); resolve(false); }, 800);
  });
}

if (await inUse()) {
  console.log(`\n  Already serving on http://localhost:${PORT}/ — nothing to do.`);
  console.log('  (If it is stale: pkill -f "vite preview" and run this again.)\n');
  process.exit(0);
}

const child = spawn('npx', ['vite', 'preview'], { stdio: 'inherit', shell: false });
child.on('exit', (code) => process.exit(code ?? 0));
