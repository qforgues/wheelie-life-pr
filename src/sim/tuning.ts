/**
 * All tunable bike numbers live here. Nothing else in the codebase should
 * hard-code a physical constant.
 *
 * Baseline: Honda Grom / MSX125 (2022+, 5-speed) with a big-bore kit.
 * See docs/DECISIONS.md #2 for why the engine is "built" rather than stock.
 */

export interface EngineTuning {
  idleRpm: number;
  redlineRpm: number;
  limiterRpm: number;
  /** Peak crank torque (N*m) and the rpm it happens at. */
  peakTorque: number;
  peakTorqueRpm: number;
  /** Shape of the torque curve either side of the peak (0..1, higher = flatter). */
  lowEndFullness: number;
  topEndFullness: number;
  /** Engine braking torque at closed throttle, scaled by rpm (N*m at redline). */
  engineBrakeTorque: number;
  /** Crank+flywheel rotational inertia (kg*m^2). Small = revs fast. */
  flywheelInertia: number;
}

export interface GearboxTuning {
  /** Primary reduction (crank -> clutch basket). */
  primaryRatio: number;
  /** Final drive reduction (countershaft -> rear wheel), = rearTeeth / frontTeeth. */
  finalRatio: number;
  /** Internal gearbox ratios, index 0 = 1st. */
  gearRatios: number[];
  /** Driveline efficiency 0..1. */
  efficiency: number;
  /** Seconds of torque interruption on a shift. This is what makes the nose dip. */
  shiftTimeUp: number;
  shiftTimeDown: number;
  /** Below this road speed the clutch slips so you can pull away from a stop. */
  clutchSlipSpeed: number;
}

export interface ChassisTuning {
  /** Combined bike + rider mass (kg). */
  mass: number;
  wheelbase: number;
  wheelRadius: number;
  /** Height of the combined centre of gravity above the road (m). */
  cgHeight: number;
  /** Horizontal distance from the REAR contact patch forward to the CG (m). */
  cgToRear: number;
  /** Pitch inertia about the CG (kg*m^2). */
  pitchInertia: number;
  /** Viscous damping on the pitch axis: suspension, chain slap, tyre carcass. */
  pitchDamping: number;
  /** Extra damping applied only while the front wheel is on the ground. */
  groundedPitchDamping: number;
  /** Bounce restitution when the front wheel slaps back down (0..1). */
  frontSlamRestitution: number;
}

export interface RiderTuning {
  /** How far back the rider can shift the CG at full pull (m). */
  weightShiftRange: number;
  /** How fast the rider body can actually move (m/s) - stops instant snapping. */
  weightShiftRate: number;
  /** Impulse torque from *yanking* the bars, per m/s of body movement (N*m per m/s). */
  yankGain: number;
}

export interface BrakeTuning {
  /** Max torque at the rear wheel (N*m). Enough to lock the rear under full load. */
  rearMaxTorque: number;
  /** Max torque at the front wheel (N*m). Only bites when the front is down. */
  frontMaxTorque: number;
  /** Fraction of the single brake input sent to the rear while both wheels are down. */
  rearBiasGrounded: number;
}

export interface TyreTuning {
  /** Peak longitudinal friction coefficient. */
  gripLong: number;
  /** Peak lateral friction coefficient. */
  gripLat: number;
  /** Slip ratio at which the rear starts to spin up audibly (0..1). */
  spinThreshold: number;
}

export interface SteeringTuning {
  /** Max yaw rate at low speed (rad/s). */
  maxYawRateLow: number;
  /** Yaw rate falls off with speed; this is the speed constant (m/s). */
  yawSpeedFalloff: number;
  /** Steering authority multiplier once the front wheel is off the ground. */
  wheelieSteerScale: number;
  /** How quickly the yaw rate reaches the commanded value. */
  yawResponse: number;
}

export interface BalanceTuning {
  /**
   * Side-to-side instability while wheelieing. 0 = rock steady (training wheels),
   * 1 = realistically twitchy. This is the "learned by feel" axis - there is
   * deliberately no on-screen meter for it.
   */
  rollInstability: number;
  /** How much steer input corrects roll while up (rad/s per unit input). */
  rollCorrection: number;
  /** Roll angle past which you drop it (rad). */
  rollCrashAngle: number;
  /** Passive self-centring, keeps low-skill riders alive. */
  rollDamping: number;
}

export interface LimitsTuning {
  /** Pitch at which the tail starts dragging - sparks + scrape audio (rad). */
  scrapePitch: number;
  /** Pitch at which you loop it out (rad). */
  crashPitch: number;
  /** Pitch below which a "wheelie" doesn't count for distance (rad). */
  wheelieCountPitch: number;
  /**
   * Nose-down torque from the tail actually dragging on the road (N*m at the
   * loop-out angle). Real bikes get this from the exhaust, subframe or cage
   * touching down, and it is the thing that makes the last few degrees feel
   * like a fight you can still win.
   */
  scrapeRestoreTorque: number;
  /** Drag force from the tail dragging (N at the loop-out angle). */
  scrapeDrag: number;
  /** Speed above which hitting something is a crash rather than a stop (m/s). */
  crashImpactSpeed: number;
}

export interface AeroTuning {
  /** 0.5 * rho * Cd * A, lumped (kg/m). Divide force by this... no: F = k * v^2. */
  dragK: number;
  /** Rolling resistance coefficient. */
  rollingResistance: number;
}

export interface BikeTuning {
  name: string;
  engine: EngineTuning;
  gearbox: GearboxTuning;
  chassis: ChassisTuning;
  rider: RiderTuning;
  brakes: BrakeTuning;
  tyre: TyreTuning;
  steering: SteeringTuning;
  balance: BalanceTuning;
  limits: LimitsTuning;
  aero: AeroTuning;
}

const DEG = Math.PI / 180;

/** The prototype bike: a built Grom. */
export const GROM: BikeTuning = {
  name: 'Grom 190 (built)',

  engine: {
    idleRpm: 1500,
    redlineRpm: 9000,
    limiterRpm: 9600,
    peakTorque: 21.0,
    peakTorqueRpm: 6200,
    lowEndFullness: 0.62,
    topEndFullness: 0.70,
    engineBrakeTorque: 7.5,
    flywheelInertia: 0.055,
  },

  gearbox: {
    primaryRatio: 3.421,
    finalRatio: 34 / 15,
    gearRatios: [2.5, 1.55, 1.15, 0.923, 0.808],
    efficiency: 0.92,
    shiftTimeUp: 0.19,
    shiftTimeDown: 0.10,
    clutchSlipSpeed: 2.2,
  },

  chassis: {
    mass: 172,
    wheelbase: 1.2,
    wheelRadius: 0.24,
    cgHeight: 0.6,
    cgToRear: 0.576,
    pitchInertia: 36,
    pitchDamping: 70,
    groundedPitchDamping: 190,
    frontSlamRestitution: 0.22,
  },

  rider: {
    weightShiftRange: 0.14,
    weightShiftRate: 0.9,
    yankGain: 900,
  },

  brakes: {
    rearMaxTorque: 460,
    frontMaxTorque: 1150,
    rearBiasGrounded: 0.42,
  },

  tyre: {
    gripLong: 1.15,
    gripLat: 1.05,
    spinThreshold: 0.14,
  },

  steering: {
    maxYawRateLow: 1.5,
    yawSpeedFalloff: 9.0,
    wheelieSteerScale: 0.35,
    yawResponse: 7.0,
  },

  balance: {
    rollInstability: 0.5,
    rollCorrection: 1.9,
    rollCrashAngle: 38 * DEG,
    rollDamping: 2.4,
  },

  limits: {
    scrapePitch: 60 * DEG,
    crashPitch: 82 * DEG,
    wheelieCountPitch: 8 * DEG,
    scrapeRestoreTorque: 430,
    scrapeDrag: 340,
    crashImpactSpeed: 6.5,
  },

  aero: {
    dragK: 0.36,
    rollingResistance: 0.016,
  },
};

/** Deep clone so the debug panel can mutate a live copy without losing the baseline. */
export function cloneTuning(t: BikeTuning): BikeTuning {
  return JSON.parse(JSON.stringify(t)) as BikeTuning;
}
