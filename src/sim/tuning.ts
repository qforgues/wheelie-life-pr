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
  /**
   * The rider's share of that (kg). Tricks move the rider's body, and the
   * combined CG follows by exactly `riderMass / mass` of the movement - which
   * is how a trick's effect on the physics is derived from the pose rather than
   * typed in beside it.
   */
  riderMass: number;
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
  /**
   * Fraction of a bump's ramp rate the suspension eats before it reaches the
   * chassis, 0..1. There is no fork travel in the model, so without this the
   * full ramp rate goes straight into body pitch and a speed bump loops you.
   * A Grom has ~100 mm of travel against a ~115 mm hump, so most of it.
   */
  bumpAbsorption: number;
  /** Hard ceiling on the pitch rate any single bump can inject (rad/s). */
  maxBumpKick: number;
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
  /** Lean torque the stick commands while the front is up (rad/s^2 per unit). */
  rollAuthority: number;
  /**
   * How hard the bike wants to stand back up. Set ABOVE
   * `rollInstability * rollDivergence` and side-to-side becomes a lean you can
   * hold; set it below and it becomes a fall you have to keep catching. It is
   * the single knob that decides which of those two games this is.
   */
  rollResponse: number;
  /** Inverted-pendulum topple gain: how hard gravity pulls you over. */
  rollDivergence: number;
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

/**
 * What each trick does to the bike.
 *
 * These are rider actions rather than bike properties, so they're shared across
 * the garage. The important one is `cgHeight`: standing on the seat lifts the
 * centre of gravity, and since the balance point is atan(cgToRear / cgHeight),
 * raising it *lowers* the angle at which the bike tips past the point of no
 * return. Standing up genuinely makes a wheelie easier to lift and easier to
 * loop, which is exactly why it scores more.
 */
export interface TrickPose {
  label: string;
  /**
   * Where the rider's body centre goes, relative to sitting normally.
   * `up` is metres off the seat, `back` is metres toward the tail.
   *
   * The sim scales these by the rider's share of the mass to move the combined
   * CG, and the renderer poses the body from the same two numbers. One source,
   * so what you see and what the bike does cannot disagree.
   */
  up: number;
  back: number;
  /** Multiplier on distance banked while it's held. */
  scoreMultiplier: number;
  /** How fast the rider gets into and out of it (1/s). */
  blendRate: number;
  /** Minimum wheelie angle before it can be started (rad). */
  minPitch: number;
}

export const TRICKS: Record<import('./types').TrickId, TrickPose> = {
  none: { label: '', up: 0, back: 0, scoreMultiplier: 1, blendRate: 6, minPitch: 0 },
  knee: {
    label: 'KNEE ON THE SEAT',
    // Down onto one knee: the body drops slightly and slides back over the seat.
    up: -0.06,
    back: 0.20,
    scoreMultiplier: 1.6,
    blendRate: 4.0,
    minPitch: 14 * DEG,
  },
  stand: {
    label: 'STANDING',
    // Straight up off the seat. This is the big one: on a bike where the rider
    // is 39% of the mass, half a metre of body movement lifts the combined CG
    // by 21 cm, which visibly lowers the balance point.
    up: 0.52,
    back: 0.06,
    scoreMultiplier: 2.4,
    blendRate: 2.6,
    minPitch: 20 * DEG,
  },
};

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
    riderMass: 70,
    wheelbase: 1.2,
    wheelRadius: 0.24,
    cgHeight: 0.6,
    cgToRear: 0.576,
    pitchInertia: 36,
    pitchDamping: 70,
    groundedPitchDamping: 190,
    frontSlamRestitution: 0.22,
    bumpAbsorption: 0.58,
    maxBumpKick: 2.4,
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
    maxYawRateLow: 1.9,
    yawSpeedFalloff: 9.0,
    wheelieSteerScale: 0.35,
    yawResponse: 8.2,
  },

  balance: {
    rollInstability: 0.35,
    // Steady-state lean is roughly rollAuthority / rollResponse. A twelve-inch
    // minibike changes direction faster than anything else here but does not
    // hang off as far as a sportbike, so: quickest steering, middling lean.
    rollAuthority: 4.5,
    rollResponse: 8.0,
    rollDivergence: 9.0,
    rollCrashAngle: 45 * DEG,
    rollDamping: 4.2,
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

/**
 * 2024 Yamaha YZ250F - the bike Justin actually asked for first.
 *
 * Real published numbers where they exist: 250 cc DOHC single, ~41 hp at
 * 13,000 rpm off ~26 N*m at 8,500, 5-speed, 1.475 m wheelbase, 107 kg dry,
 * 21"/19" spoked wheels, 12 inches of suspension travel at both ends.
 *
 * Against the Grom this should feel like a completely different animal, which
 * is the whole point of having more than one: four times the power in a bike
 * that weighs the same, a CG 16 cm higher, and a rider who can move 22 cm
 * instead of 14. It lofts in three gears instead of two and the balance point
 * swings much further as you move around on it.
 */
export const YZ250F: BikeTuning = {
  name: 'Yamaha YZ250F (2024)',

  engine: {
    idleRpm: 1900,
    redlineRpm: 13500,
    limiterRpm: 14000,
    peakTorque: 26,
    peakTorqueRpm: 8500,
    // A 250 four-stroke MX motor is all top end - it signs off late and hard,
    // which is why `topEndFullness` is high and the bottom is comparatively soft.
    lowEndFullness: 0.55,
    topEndFullness: 0.86,
    engineBrakeTorque: 9,
    // Light MX flywheel. Revs and drops revs almost instantly.
    flywheelInertia: 0.035,
  },

  gearbox: {
    primaryRatio: 3.353,
    finalRatio: 50 / 13,
    gearRatios: [2.143, 1.75, 1.444, 1.222, 1.045],
    efficiency: 0.92,
    shiftTimeUp: 0.14,
    shiftTimeDown: 0.1,
    clutchSlipSpeed: 2.6,
  },

  chassis: {
    mass: 175,
    riderMass: 68,
    wheelbase: 1.475,
    // Rear wheel: 100/90-19 => 0.241 rim + 0.090 sidewall.
    wheelRadius: 0.331,
    cgHeight: 0.76,
    cgToRear: 0.72,
    pitchInertia: 52,
    pitchDamping: 75,
    groundedPitchDamping: 210,
    frontSlamRestitution: 0.15,
    // 12 inches of fork travel soaks up almost everything.
    bumpAbsorption: 0.74,
    maxBumpKick: 2.6,
  },

  rider: {
    // Long flat seat and a standing option: far more room to move than a Grom.
    weightShiftRange: 0.22,
    weightShiftRate: 1.2,
    yankGain: 1100,
  },

  brakes: {
    rearMaxTorque: 560,
    frontMaxTorque: 1600,
    rearBiasGrounded: 0.38,
  },

  tyre: {
    // Knobbies on cobblestone: less bite than the Grom's street rubber.
    gripLong: 1.05,
    gripLat: 0.95,
    spinThreshold: 0.12,
  },

  steering: {
    maxYawRateLow: 2.05,
    yawSpeedFalloff: 10,
    wheelieSteerScale: 0.4,
    yawResponse: 8.6,
  },

  balance: {
    rollInstability: 0.35,
    // Tall, narrow and light on knobblies: it falls into a turn faster than
    // either of the others and will hang over a long way before it lets go.
    rollAuthority: 5.2,
    // Taller and lighter than the Grom, so it moves around more underneath you -
    // but the restoring term still has to win, or a held lean walks all the way
    // to the lowside angle. At 7.5 full stick parked at 37.7 deg against a 45
    // deg limit, which is no margin at all.
    rollResponse: 9.0,
    rollDivergence: 10,
    rollCrashAngle: 45 * DEG,
    rollDamping: 4.0,
  },

  limits: {
    // High tail and long travel: it will stand up a lot further before the
    // back of it finds the road.
    scrapePitch: 68 * DEG,
    crashPitch: 86 * DEG,
    wheelieCountPitch: 8 * DEG,
    scrapeRestoreTorque: 470,
    scrapeDrag: 360,
    crashImpactSpeed: 6.5,
  },

  aero: {
    // Upright rider, no fairing, plate on the front: it pushes a lot of air.
    dragK: 0.72,
    rollingResistance: 0.018,
  },
};

/**
 * Ducati Streetfighter V4 - "a more sporty Ducati bike".
 *
 * 1103 cc V4, 208 hp at 12,750 off 123 N*m at 11,500, six speeds, 1.488 m
 * wheelbase, 201 kg wet, 17" cast wheels on sticky street rubber.
 *
 * The third character in the garage. Where the YZ lifts because it is light
 * with a high CG and a rider who can move, this lifts because it simply makes
 * an absurd amount of torque. It is 94 kg heavier than the YZ, the rider is
 * tucked into a short seat with barely any room to shift, and the balance point
 * sits high - so it comes up violently and is then the hardest of the three to
 * actually hold.
 */
export const STREETFIGHTER: BikeTuning = {
  name: 'Ducati Streetfighter V4',

  engine: {
    idleRpm: 1400,
    redlineRpm: 13000,
    limiterRpm: 14000,
    peakTorque: 123,
    peakTorqueRpm: 11500,
    // A big V4 pulls hard from everywhere and keeps pulling to the limiter.
    lowEndFullness: 0.58,
    topEndFullness: 0.88,
    engineBrakeTorque: 26,
    flywheelInertia: 0.09,
  },

  gearbox: {
    primaryRatio: 1.8,
    finalRatio: 42 / 15,
    gearRatios: [2.462, 1.947, 1.611, 1.409, 1.238, 1.107],
    efficiency: 0.94,
    shiftTimeUp: 0.07,
    shiftTimeDown: 0.07,
    clutchSlipSpeed: 3.0,
  },

  chassis: {
    mass: 269,
    riderMass: 68,
    wheelbase: 1.488,
    // Rear 200/60-17 => 0.216 rim + 0.120 sidewall.
    wheelRadius: 0.336,
    cgHeight: 0.68,
    cgToRear: 0.70,
    pitchInertia: 62,
    pitchDamping: 85,
    groundedPitchDamping: 240,
    frontSlamRestitution: 0.18,
    // Short sport travel: it does not soak up a speed bump the way the YZ does.
    bumpAbsorption: 0.42,
    maxBumpKick: 2.2,
  },

  rider: {
    // Short seat, tucked riding position, nowhere to go.
    weightShiftRange: 0.12,
    weightShiftRate: 0.85,
    yankGain: 900,
  },

  brakes: {
    rearMaxTorque: 620,
    frontMaxTorque: 2600,
    rearBiasGrounded: 0.30,
  },

  tyre: {
    gripLong: 1.35,
    gripLat: 1.30,
    spinThreshold: 0.10,
  },

  steering: {
    maxYawRateLow: 1.55,
    yawSpeedFalloff: 12,
    wheelieSteerScale: 0.25,
    yawResponse: 6.9,
  },

  balance: {
    rollInstability: 0.35,
    // Heavy: less authority to move it, and slower to come back.
    // 200 kg takes real effort to tip in, and then goes further over than
    // anything else here - which is exactly how a superbike feels.
    rollAuthority: 5.6,
    rollResponse: 8.2,
    rollDivergence: 9.0,
    rollCrashAngle: 42 * DEG,
    rollDamping: 4.6,
  },

  limits: {
    scrapePitch: 58 * DEG,
    crashPitch: 80 * DEG,
    wheelieCountPitch: 8 * DEG,
    scrapeRestoreTorque: 520,
    scrapeDrag: 420,
    crashImpactSpeed: 6.5,
  },

  aero: {
    dragK: 0.26,
    rollingResistance: 0.015,
  },
};

/**
 * The garage. Justin asked for three bikes that feel genuinely different, so
 * a bike is data rather than code on both sides - tuning here, bodywork and
 * stance in view/bikeVisuals.ts.
 */
export const BIKES = {
  yz250f: YZ250F,
  streetfighter: STREETFIGHTER,
  grom: GROM,
} as const;

export type BikeId = keyof typeof BIKES;

/** Free starter bike, per the interview. */
export const STARTER_BIKE: BikeId = 'grom';

/** Deep clone so the debug panel can mutate a live copy without losing the baseline. */
export function cloneTuning(t: BikeTuning): BikeTuning {
  return JSON.parse(JSON.stringify(t)) as BikeTuning;
}
