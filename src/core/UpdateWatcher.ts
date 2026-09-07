import { BUILD_ID } from './version';

/**
 * Notices when a newer build has been deployed, without interrupting the ride.
 *
 * The rule from Justin's dad: never reboot the game underneath him. A new
 * deploy raises a flag; he keeps playing the build he is on and installs when
 * he chooses. Because Vite fingerprints every asset, the running page keeps
 * working indefinitely - nothing it already loaded is ever pulled away.
 */
export class UpdateWatcher {
  /** Set once a different build is live. Never goes back to false. */
  available = false;
  /** The build id waiting to be installed, for the menu to show. */
  latest: string | null = null;

  private timer: number | null = null;

  constructor(
    private onAvailable: (latest: string) => void,
    private everySeconds = 120,
  ) {}

  start(): void {
    // A first check shortly after boot catches "they left the tab open
    // overnight and we shipped twice"; after that it is a slow poll.
    this.timer = setTimeout(() => this.tick(), 15_000) as unknown as number;
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    await this.check();
    if (this.available) return;
    this.timer = setTimeout(() => this.tick(), this.everySeconds * 1000) as unknown as number;
  }

  private async check(): Promise<void> {
    try {
      // `no-store` plus a cache-buster: this one request must never be answered
      // from a cache, or the check can never see a new build.
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { build?: unknown };
      if (typeof data.build !== 'string' || data.build === BUILD_ID) return;
      this.available = true;
      this.latest = data.build;
      this.onAvailable(data.build);
    } catch {
      // Offline, or running from `vite dev` where there is no manifest. Not
      // being able to check for an update is not a problem worth reporting.
    }
  }
}

/**
 * Reload onto the newest build, clearing anything that could serve a stale one.
 *
 * This is the "hard refresh" that a game pad cannot ask the browser for. On the
 * Xbox there is no Ctrl+Shift+R without plugging in a keyboard, so the game has
 * to be able to do it itself: drop the Cache Storage entries, drop any service
 * worker, then reload through a URL the HTTP cache has never seen.
 */
export async function hardReload(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* Cache Storage unavailable - the cache-busted URL below still works. */
  }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (regs) await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* no service worker, or no permission to look */
  }
  const url = new URL(location.href);
  url.searchParams.set('v', String(Date.now()));
  location.replace(url.toString());
}
