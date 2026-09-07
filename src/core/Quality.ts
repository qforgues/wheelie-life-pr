import * as THREE from 'three';

/**
 * Render quality tiers, chosen up front from the device and stepped down if the
 * frame rate can't hold.
 *
 * The desktop dev machine is not the target. The Xbox browser is a sandboxed
 * Chromium with a fraction of the GPU budget and a hard memory ceiling, so it
 * starts a tier down and drops further on its own rather than juddering.
 */
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowDistance: number;
  fogFar: number;
  antialias: boolean;
  /**
   * Bloom strength, and 0 means no post-processing chain at all.
   *
   * The console gets 0 deliberately: bloom needs the frame in a buffer first,
   * and eleven megabytes of render targets is the wrong trade on a machine
   * that has already run out of memory once. It keeps the grade and the low
   * sun, which is most of the look for none of the memory.
   */
  bloom: number;
}

export const TIERS: Record<QualityTier, QualitySettings> = {
  high: {
    maxPixelRatio: 2, shadows: true, shadowMapSize: 2048,
    shadowDistance: 70, fogFar: 1350, antialias: true, bloom: 0.30,
  },
  medium: {
    maxPixelRatio: 1.25, shadows: true, shadowMapSize: 1024,
    shadowDistance: 45, fogFar: 900, antialias: true, bloom: 0.22,
  },
  low: {
    maxPixelRatio: 1, shadows: false, shadowMapSize: 512,
    shadowDistance: 30, fogFar: 600, antialias: false, bloom: 0,
  },
};

const ORDER: QualityTier[] = ['high', 'medium', 'low'];

/**
 * Where a device that has already failed gets remembered.
 *
 * This is the important one. The Xbox reports itself as `desktop / other` -
 * whatever its user agent says, it is not the string we were testing for - so
 * it was handed the full desktop build, post-processing chain and all, and lost
 * the WebGL context at four frames a second. **Sniffing the user agent for a
 * brand name is guessing, and it guessed wrong on the one machine that matters.**
 *
 * So the machine tells us instead. Lose a context or fail to hold a frame rate
 * and the tier that did it is written down; the next load starts below it and
 * stays there. A device only has to fail once, ever.
 */
const SAFE_KEY = 'wheelie-life:tier';

export function rememberTier(tier: QualityTier): void {
  try {
    localStorage.setItem(SAFE_KEY, tier);
  } catch {
    /* private window, no storage - it will just have to fail again */
  }
}

export function forgetTier(): void {
  try {
    localStorage.removeItem(SAFE_KEY);
  } catch { /* nothing to forget */ }
}

function remembered(): QualityTier | null {
  try {
    const v = localStorage.getItem(SAFE_KEY);
    return v === 'low' || v === 'medium' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

/** The tier below this one, or the same one if there is nothing below. */
export function lowerTier(tier: QualityTier): QualityTier {
  const i = ORDER.indexOf(tier);
  return ORDER[Math.min(ORDER.length - 1, i + 1)];
}

/** Best guess before a single frame has been drawn. */
export function initialTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'high';
  // ?tier=low forces the console build on a desktop, which is the only way to
  // see what Justin sees without sitting in front of the Xbox. It changes what
  // gets BUILT, not just how it is drawn, so it has to be read here - before
  // the city exists. It also beats anything remembered, so there is always a
  // way to ask for a specific build by hand.
  if (typeof location !== 'undefined') {
    const want = new URLSearchParams(location.search).get('tier');
    if (want === 'low' || want === 'medium' || want === 'high') return want;
  }

  // What this machine has already proved it cannot do beats any guess about it.
  const known = remembered();
  if (known) return known;

  const ua = navigator.userAgent;
  // Consoles start at the bottom. The Xbox ran out of GPU memory at medium and
  // dropped the context, and the governor only ever steps DOWN - so by the time
  // it reacted the damage was done.
  //
  // The UA test stays because when it does match it is right, but it is no
  // longer the only line of defence: a console that does not announce itself
  // gets caught by the remembered tier above after exactly one bad load.
  if (/xbox|playstation|nintendo/i.test(ua)) return 'low';
  if (/android|iphone|ipad|mobile/i.test(ua)) return 'medium';

  // A desktop has to look like one. deviceMemory is in gigabytes and undefined
  // on Safari, so it only ever argues DOWN - four cores or four gigabytes is
  // not a machine to hand a bloom chain to on the first frame.
  const cores = navigator.hardwareConcurrency ?? 4;
  const gb = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores <= 4 || gb <= 4) return 'medium';
  return 'high';
}

/**
 * Watches the frame rate and drops a tier when it can't hold up.
 *
 * Deliberately one-way: hunting up and down produces visible popping mid-ride,
 * and a wheelie is exactly the moment you don't want the shadows to change.
 */
export class QualityGovernor {
  tier: QualityTier;
  /** Set for one frame when the tier changes, so the UI can say so. */
  justChanged = false;

  private samples: number[] = [];
  private cooldown = 3;

  constructor(
    tier: QualityTier,
    private apply: (s: QualitySettings, tier: QualityTier) => void,
  ) {
    this.tier = tier;
  }

  get settings(): QualitySettings {
    return TIERS[this.tier];
  }

  update(dt: number): void {
    this.justChanged = false;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }
    if (dt > 0) this.samples.push(1 / dt);
    if (this.samples.length < 90) return;

    // Median rather than mean: one hitch shouldn't cost a whole tier.
    this.samples.sort((a, b) => a - b);
    const median = this.samples[Math.floor(this.samples.length / 2)];
    this.samples.length = 0;

    const index = ORDER.indexOf(this.tier);
    if (median < 45 && index < ORDER.length - 1) {
      this.tier = ORDER[index + 1];
      this.cooldown = 5;
      this.justChanged = true;
      this.apply(TIERS[this.tier], this.tier);
    }
  }

  /** Force a tier from the debug panel. */
  set(tier: QualityTier): void {
    this.tier = tier;
    this.cooldown = 5;
    this.samples.length = 0;
    this.apply(TIERS[tier], tier);
  }
}

/** Pushes a settings block onto the renderer, sun and fog. */
export function applyQuality(
  s: QualitySettings,
  renderer: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight,
  fog: THREE.Fog | null,
): void {
  renderer.setPixelRatio(Math.min(devicePixelRatio, s.maxPixelRatio));
  renderer.shadowMap.enabled = s.shadows;
  if (sun.shadow.mapSize.width !== s.shadowMapSize) {
    sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
    // Force the shadow map to be rebuilt at the new size.
    sun.shadow.map?.dispose();
    sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }
  sun.castShadow = s.shadows;
  const cam = sun.shadow.camera;
  cam.left = -s.shadowDistance;
  cam.right = s.shadowDistance;
  cam.top = s.shadowDistance;
  cam.bottom = -s.shadowDistance;
  cam.updateProjectionMatrix();
  if (fog) fog.far = s.fogFar;
}
