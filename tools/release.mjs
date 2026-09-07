#!/usr/bin/env node
/**
 * The gate between beta and live.
 *
 * Localhost is beta and belongs to whoever is working. The .dev site is live -
 * it is what Justin loads on the Xbox - and nothing reaches it without an
 * explicit sign-off. `npm run deploy` therefore does not deploy: it builds,
 * checks, and tells you how to try it locally. `npm run deploy:live` is the one
 * that publishes, and it only runs when a human passes --live.
 */
import { execSync } from 'node:child_process';

const live = process.argv.includes('--live');
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

const CYAN = '\x1b[36m';
const GOLD = '\x1b[33m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

run('npm run check');

if (!live) {
  console.log(`
${CYAN}Beta build is ready.${OFF}

  ${DIM}Try it on localhost first:${OFF}
    npm run beta            ${DIM}# serves the built game on http://localhost:4173${OFF}

  ${GOLD}This did NOT publish to the Xbox site.${OFF}
  ${DIM}Once it has been signed off, publish with:${OFF}
    npm run deploy:live
`);
  process.exit(0);
}

console.log(`\n${GOLD}Publishing to the live Xbox site…${OFF}\n`);
run('npx wrangler deploy');

const version = JSON.parse(
  execSync('cat dist/version.json', { encoding: 'utf8' }),
);
console.log(`
${CYAN}Live.${OFF}  build ${GOLD}${version.build}${OFF}

  ${DIM}Anyone already playing keeps their session and sees "UPDATE READY".
  Nothing reloads underneath them.${OFF}
`);
