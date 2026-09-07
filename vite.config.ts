import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

/**
 * Every build gets an identity, and the built site publishes it.
 *
 * Two jobs. Justin needs to be able to read which version he is on off the menu
 * to tell us whether he is testing what we think he is testing. And the running
 * game needs to notice that a newer one has been deployed - without reloading
 * itself out from under a wheelie.
 *
 * The id is stamped into the bundle at compile time *and* written to
 * `version.json` beside it by the same build, so the two can never disagree.
 */
function shortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return 'nogit';
  }
}

const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('');
const BUILD_ID = `${pkg.version}+${stamp}.${shortSha()}`;

/**
 * What a dev server calls itself.
 *
 * `shortSha()` runs once, when this config is loaded - so a dev server left
 * running while work carries on reports the commit it was STARTED at, forever.
 * That looked exactly like a caching problem: force refresh, disable cache,
 * still the old id, because the server itself was stale rather than the browser.
 * Dev builds now say so out loud.
 */
const DEV_BUILD_ID = `${pkg.version}+dev.${shortSha()}`;

function versionManifest(): Plugin {
  return {
    name: 'wheelie-version-manifest',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist/version.json');
      writeFileSync(out, JSON.stringify({ build: BUILD_ID, at: now.toISOString() }, null, 2));
    },
  };
}

/**
 * Serves a LIVE version.json while developing.
 *
 * Without it the dev server answers /version.json with index.html, so the
 * update check quietly does nothing and there is no way to tell from inside the
 * game that the server has fallen behind. This recomputes the sha per request,
 * so a dev server running behind HEAD raises UPDATE READY - which is exactly
 * what it should be telling you.
 */
function devVersion(): Plugin {
  return {
    name: 'wheelie-dev-version',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          build: `${pkg.version}+dev.${shortSha()}`,
          at: new Date().toISOString(),
        }));
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './',
  // three/examples/jsm/* resolves `three` separately from the pre-bundled copy
  // in dev, which loads two instances and breaks instanceof across them.
  resolve: { dedupe: ['three'] },
  define: {
    __BUILD_ID__: JSON.stringify(command === 'serve' ? DEV_BUILD_ID : BUILD_ID),
  },
  plugins: [versionManifest(), devVersion()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
