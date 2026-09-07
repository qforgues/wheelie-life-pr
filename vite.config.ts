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

export default defineConfig({
  base: './',
  // three/examples/jsm/* resolves `three` separately from the pre-bundled copy
  // in dev, which loads two instances and breaks instanceof across them.
  resolve: { dedupe: ['three'] },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionManifest()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
