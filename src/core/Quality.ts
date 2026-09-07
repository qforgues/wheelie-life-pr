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
}

export const TIERS: Record<QualityTier, QualitySettings> = {
  high: {
    maxPixelRatio: 2, shadows: true, shadowMapSize: 2048,
    shadowDistance: 70, fogFar: 1350, antialias: true,
  },
  medium: {
    maxPixelRatio: 1.25, shadows: true, shadowMapSize: 1024,
    shadowDistance: 45, fogFar: 900, antialias: true,
  },
  low: {
    maxPixelRatio: 1, shadows: false, shadowMapSize: 512,
    shadowDistance: 30, fogFar: 600, antialias: false,
  },
};

const ORDER: QualityTier[] = ['high', 'medium', 'low'];

/** Best guess before a single frame has been drawn. */
export function initialTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'high';
  // ?tier=low forces the console build on a desktop, which is the only way to
  // see what Justin sees without sitting in front of the Xbox. It changes what
  // gets BUILT, not just how it is drawn, so it has to be read here - before
  // the city exists.
  if (typeof location !== 'undefined') {
    const want = new URLSearchParams(location.search).get('tier');
    if (want === 'low' || want === 'medium' || want === 'high') return want;
  }
  const ua = navigator.userAgent;
  // The Xbox browser starts at the bottom. It ran out of GPU memory at medium
  // and dropped the WebGL context, and the governor only ever steps *down* - so
  // by the time it reacted the damage was done. Shadows are worth less than a
  // picture. Everything else console-ish still gets a middle tier.
  if (/xbox/i.test(ua)) return 'low';
  if (/playstation|nintendo/i.test(ua)) return 'medium';
  if (/android|iphone|ipad|mobile/i.test(ua)) return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores <= 4 ? 'medium' : 'high';
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
