/** Engine-agnostic input snapshot. Everything the sim needs, nothing it doesn't. */
export interface RiderInput {
  /** R2 / W. 0..1 */
  throttle: number;
  /** L2 / S. 0..1 - a single brake lever; the sim distributes it front/rear. */
  brake: number;
  /** Left stick X / A,D. -1 (left) .. 1 (right) */
  steer: number;
  /**
   * Left stick Y / Space & Shift. -1 (lean forward) .. 1 (pull back).
   * Pulling back both shifts the CG rearward and, if yanked, throws in an impulse.
   */
  weight: number;
  /** R1 - edge triggered by the input layer, true for exactly one sim step. */
  shiftUp: boolean;
  /** L1 - edge triggered. */
  shiftDown: boolean;
}

export function emptyInput(): RiderInput {
  return { throttle: 0, brake: 0, steer: 0, weight: 0, shiftUp: false, shiftDown: false };
}

export type BikeMode = 'riding' | 'crashed' | 'resetting';

/** Read-only view of the sim, consumed by rendering, audio, HUD and scoring. */
export interface BikeState {
  mode: BikeMode;

  // --- world placement -------------------------------------------------
  /** Metres. y is up. */
  x: number;
  y: number;
  z: number;
  /** Heading around the world Y axis (rad). */
  yaw: number;
  /** Nose-up rotation about the rear contact patch (rad). Always >= 0. */
  pitch: number;
  /** Lean/roll (rad). Positive = falling to the rider's right. */
  roll: number;

  // --- motion ----------------------------------------------------------
  /** Forward road speed (m/s). */
  speed: number;
  /** Longitudinal acceleration (m/s^2). */
  accel: number;
  /** Pitch rate (rad/s). */
  pitchRate: number;
  yawRate: number;

  // --- driveline -------------------------------------------------------
  rpm: number;
  /** 0-based index into gearRatios. */
  gear: number;
  /** True while the box is between gears and making no torque. */
  shifting: boolean;
  /** Normalised rear wheel slip, 0..1+. Above tyre.spinThreshold it's spinning. */
  wheelSlip: number;
  /** True while the rev limiter is cutting. */
  onLimiter: boolean;

  // --- derived cues (the game's substitute for a balance meter) --------
  /** True when the front wheel is off the ground. */
  wheelieing: boolean;
  /** True when the tail is dragging: sparks + scrape audio. */
  scraping: boolean;
  /**
   * How close pitch is to the (unstable) balance point, signed.
   * < 0 = falling forward, 0 = balanced, > 0 = going over.
   * NOT surfaced on the HUD - it drives haptics, audio and camera only.
   */
  balanceError: number;
  /** The current balance point (rad), which moves as the rider shifts weight. */
  balancePoint: number;
  /** Impact speed of the last crash, for the camera shake. */
  lastImpact: number;
  /** Cause of the current crash, for the reset banner. */
  crashReason: CrashReason | null;
}

export type CrashReason = 'looped' | 'lowside' | 'impact' | 'nosedive';

/** What the world tells the sim about the road under the rear wheel. */
export interface GroundSample {
  /** Surface height (m). */
  height: number;
  /** Friction multiplier applied to tyre grip. 1 = clean asphalt. */
  friction: number;
  /**
   * Pitch impulse from a bump or kerb (rad/s), applied once as the wheel
   * rolls over it. This is how you pop the front up off a speed bump.
   */
  bumpKick: number;
}

export interface GroundProvider {
  sample(x: number, z: number, speed: number, dt: number): GroundSample;
  /** Returns a crash if the bike has driven into something solid. */
  collide(x: number, z: number, speed: number): CrashReason | null;
}
