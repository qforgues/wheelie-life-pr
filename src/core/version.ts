declare const __BUILD_ID__: string;

/**
 * This build's identity, stamped in by Vite. Shown on the menu so Justin can
 * say which version he is on, and compared against the deployed `version.json`
 * to notice an update.
 */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** Just the part worth reading aloud: `0.1.0+20260906.a1b2c3d` -> `0.1.0`. */
export const VERSION = BUILD_ID.split('+')[0];
