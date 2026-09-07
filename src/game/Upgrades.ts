import type { BikeTuning } from '../sim/tuning';

/**
 * Bike upgrades.
 *
 * Four parts, three levels each, bought per bike. They exist to give money a
 * second job: without them the only thing to save for was the next bike, so
 * once you owned the Ducati earning stopped meaning anything.
 *
 * Every level does something you can feel in the physics rather than adding a
 * number to a sheet - and each one has a real cost, not just a price. Power
 * makes the bike harder to hold; a lighter bike loses the flywheel that keeps a
 * wheelie steady. Buying everything should not be obviously correct.
 */
export type UpgradeId =
  | 'engine' | 'tyres' | 'suspension' | 'weight'
  | 'swingarm' | 'gearing' | 'clutch'
  | 'scanner' | 'plates';

export interface UpgradeLevel {
  label: string;
  /** What it does, in the rider's words. */
  blurb: string;
  price: number;
  apply(t: BikeTuning): void;
}

export interface UpgradeKind {
  name: string;
  /** Shown under the name when nothing is bought yet. */
  summary: string;
  /**
   * Whether this is bolted to the bike or belongs to the rider.
   *
   * The scanner is yours, not the bike's - you do not re-buy it every time you
   * change machine - so it is tracked separately and carries a different pill.
   */
  scope: 'bike' | 'rider';
  levels: UpgradeLevel[];
}

export const UPGRADES: Record<UpgradeId, UpgradeKind> = {
  engine: {
    scope: 'bike',
    name: 'ENGINE',
    summary: 'More drive. Lifts easier, and harder to hold.',
    levels: [
      {
        label: 'Exhaust & tune',
        blurb: '+12% torque. It comes up quicker in every gear.',
        price: 900,
        apply: (t) => { t.engine.peakTorque *= 1.12; },
      },
      {
        label: 'Cams & intake',
        blurb: '+22% torque and 800 more revs.',
        price: 2600,
        apply: (t) => {
          t.engine.peakTorque *= 1.22;
          t.engine.redlineRpm += 800;
          t.engine.limiterRpm += 800;
        },
      },
      {
        label: 'Big bore',
        blurb: '+30% torque and 1300 revs. Loops out if you are lazy.',
        price: 6800,
        apply: (t) => {
          t.engine.peakTorque *= 1.30;
          t.engine.redlineRpm += 1300;
          t.engine.limiterRpm += 1300;
        },
      },
    ],
  },
  tyres: {
    scope: 'bike',
    name: 'TYRES',
    summary: 'Grip. Less spin off the bottom, more lean before it goes.',
    levels: [
      { label: 'Fresh rubber', blurb: '+10% grip, 4° more lean before it lets go.', price: 600,
        apply: (t) => {
          t.tyre.gripLong *= 1.10; t.tyre.gripLat *= 1.10;
          t.balance.rollCrashAngle += 4 * (Math.PI / 180);
        } },
      { label: 'Sport compound', blurb: '+20% grip, 9° more lean, hooks up sooner.', price: 1900,
        apply: (t) => {
          t.tyre.gripLong *= 1.20; t.tyre.gripLat *= 1.18;
          t.tyre.spinThreshold *= 1.15;
          t.balance.rollCrashAngle += 9 * (Math.PI / 180);
        } },
      { label: 'Race slicks', blurb: '+32% grip and 15° more lean. Hard to lose.', price: 5200,
        apply: (t) => {
          t.tyre.gripLong *= 1.32; t.tyre.gripLat *= 1.30;
          t.tyre.spinThreshold *= 1.3;
          t.balance.rollCrashAngle += 15 * (Math.PI / 180);
        } },
    ],
  },
  suspension: {
    scope: 'bike',
    name: 'SUSPENSION',
    summary: 'Soaks up the muertos and steadies the balance point.',
    levels: [
      { label: 'Fresh oil', blurb: 'Bumps kick 15% less.', price: 700,
        apply: (t) => { t.chassis.bumpAbsorption = mix(t.chassis.bumpAbsorption, 1, 0.15); } },
      { label: 'Revalved', blurb: 'Bumps kick 30% less and it wanders less up top.', price: 2100,
        apply: (t) => {
          t.chassis.bumpAbsorption = mix(t.chassis.bumpAbsorption, 1, 0.3);
          t.balance.rollDamping *= 1.15;
        } },
      { label: 'Full race kit', blurb: 'Barely notices a bump, and holds a line.', price: 5600,
        apply: (t) => {
          t.chassis.bumpAbsorption = mix(t.chassis.bumpAbsorption, 1, 0.5);
          t.balance.rollDamping *= 1.3;
          t.balance.rollDivergence *= 0.88;
        } },
    ],
  },
  weight: {
    scope: 'bike',
    name: 'WEIGHT',
    summary: 'Lighter. Quicker everywhere, and twitchier with it.',
    levels: [
      { label: 'Strip it', blurb: '-6% weight. Turns in faster.', price: 800,
        apply: (t) => { lighten(t, 0.06); } },
      { label: 'Ali & plastics', blurb: '-12% weight.', price: 2400,
        apply: (t) => { lighten(t, 0.12); } },
      { label: 'Carbon everything', blurb: '-20% weight. Nothing steadies it now.', price: 6400,
        apply: (t) => { lighten(t, 0.20); } },
    ],
  },
  swingarm: {
    scope: 'bike',
    name: 'SWINGARM',
    summary: 'A longer arm. The single best thing for holding a wheelie.',
    levels: [
      {
        label: '+30 mm',
        blurb: 'Balance point sits higher. Easier to hold, slower to turn.',
        price: 800,
        apply: (t) => { stretch(t, 0.03); },
      },
      {
        label: '+70 mm',
        blurb: 'Noticeably steadier up top. Turns in lazily.',
        price: 2500,
        apply: (t) => { stretch(t, 0.07); },
      },
      {
        label: 'Extended arm',
        blurb: 'Sits up almost on its own. Handles like a bus.',
        price: 5900,
        apply: (t) => { stretch(t, 0.13); },
      },
    ],
  },
  gearing: {
    scope: 'bike',
    name: 'GEARING',
    summary: 'Sprockets. Trades top end for how hard it pulls.',
    levels: [
      { label: '+2 rear teeth', blurb: 'Lifts easier everywhere. A little less top speed.', price: 500,
        apply: (t) => { t.gearbox.finalRatio *= 1.07; } },
      { label: '+4 rear teeth', blurb: 'Pulls hard and revs out early.', price: 1600,
        apply: (t) => { t.gearbox.finalRatio *= 1.14; } },
      { label: 'Wheelie sprocket', blurb: 'Brutal off the bottom. Top speed is gone.', price: 3900,
        apply: (t) => { t.gearbox.finalRatio *= 1.24; } },
    ],
  },
  clutch: {
    scope: 'bike',
    name: 'CLUTCH',
    summary: 'How cleanly the drive arrives, and how fast it shifts.',
    levels: [
      { label: 'Heavy springs', blurb: 'Shifts 15% quicker. Less nose-dip on the change.', price: 650,
        apply: (t) => {
          t.gearbox.shiftTimeUp *= 0.85;
          t.gearbox.shiftTimeDown *= 0.85;
        } },
      { label: 'Slipper clutch', blurb: 'Shifts 30% quicker and drives off the bottom.', price: 2000,
        apply: (t) => {
          t.gearbox.shiftTimeUp *= 0.7;
          t.gearbox.shiftTimeDown *= 0.7;
          t.gearbox.clutchSlipSpeed *= 1.25;
        } },
      { label: 'Race basket', blurb: 'Near-instant shifts. Time the pull through them.', price: 4800,
        apply: (t) => {
          t.gearbox.shiftTimeUp *= 0.5;
          t.gearbox.shiftTimeDown *= 0.5;
          t.gearbox.clutchSlipSpeed *= 1.4;
          t.gearbox.efficiency = Math.min(0.99, t.gearbox.efficiency * 1.03);
        } },
    ],
  },
  scanner: {
    scope: 'rider',
    name: 'SCANNER',
    summary: 'Police radio. Puts them on your GPS.',
    levels: [
      {
        label: 'Handheld',
        blurb: 'Anyone actively chasing you shows on the GPS.',
        price: 1200,
        apply: () => { /* read by the GPS, not the physics */ },
      },
      {
        label: 'Full band',
        blurb: 'The whole shift shows, not just the ones after you.',
        price: 3400,
        apply: () => { /* ditto */ },
      },
      {
        label: 'Trunked + plates',
        blurb: 'Adds which way each one is pointing. See them coming.',
        price: 6800,
        apply: () => { /* ditto */ },
      },
    ],
  },
  plates: {
    scope: 'rider',
    name: 'PLATES',
    summary: 'Harder to identify. Heat builds slower and fades faster.',
    levels: [
      { label: 'Dirty plate', blurb: 'They take a little longer to be sure it is you.', price: 900,
        apply: () => { /* read by the police, not the physics */ } },
      { label: 'Tilt bracket', blurb: 'Heat builds noticeably slower.', price: 2800,
        apply: () => { /* ditto */ } },
      { label: 'Flip plate', blurb: 'Heat builds slowly and cools twice as fast.', price: 6200,
        apply: () => { /* ditto */ } },
    ],
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

/** Only these are applied to a bike's tuning; the rest belong to the rider. */
export const BIKE_UPGRADE_IDS = UPGRADE_IDS.filter((id) => UPGRADES[id].scope === 'bike');

/** What the scanner shows at each level. Read by the GPS. */
export type ScannerMode = 'none' | 'chasers' | 'all' | 'heading';

/**
 * How much the plates slow the police down.
 *
 * Returns a pair of multipliers: how fast heat builds, and how fast it fades.
 * Rider-scope like the scanner, because it is your bike's plate wherever you
 * bolt it.
 */
export function plateEffect(level: number): { gain: number; cool: number } {
  switch (level) {
    case 1: return { gain: 0.85, cool: 1.15 };
    case 2: return { gain: 0.68, cool: 1.4 };
    case 3: return { gain: 0.52, cool: 2.0 };
    default: return { gain: 1, cool: 1 };
  }
}

export function scannerMode(level: number): ScannerMode {
  return level >= 3 ? 'heading' : level >= 2 ? 'all' : level >= 1 ? 'chasers' : 'none';
}

/** Levels owned per bike, e.g. `{ engine: 2 }` means two engine levels bought. */
export type UpgradeLevels = Partial<Record<UpgradeId, number>>;

function mix(from: number, to: number, k: number): number {
  return from + (to - from) * k;
}

/**
 * Taking weight off makes the bike quicker AND less settled.
 *
 * Mass carries the rotational inertia that makes a wheelie sit still, so a
 * featherweight bike is faster to lift and much harder to hold there. That is
 * the trade, and it is why buying every level is not automatically right.
 */
/**
 * Extends the swingarm.
 *
 * Moving the rear axle back lengthens the wheelbase and puts the CG further
 * forward OF that axle, which raises the balance point - the angle the bike
 * naturally sits at. That is the whole reason wheelie bikes run long arms. The
 * cost is steering: a longer bike does not want to change direction.
 *
 * This replaced a brakes upgrade that did nothing measurable at all. Brake
 * torque already saturates the available grip, so buying more of it changed
 * neither stopping distance nor how fast the nose came down.
 */
function stretch(t: BikeTuning, metres: number): void {
  t.chassis.wheelbase += metres;
  t.chassis.cgToRear += metres * 0.82;
  t.chassis.pitchInertia *= 1 + metres * 1.1;
  t.steering.maxYawRateLow *= 1 - metres * 0.9;
  t.balance.rollAuthority *= 1 - metres * 0.7;
}

function lighten(t: BikeTuning, frac: number): void {
  t.chassis.mass *= 1 - frac;
  t.chassis.pitchInertia *= 1 - frac * 1.15;
  t.steering.maxYawRateLow *= 1 + frac * 0.5;
  t.balance.rollAuthority *= 1 + frac * 0.4;
}

/**
 * Applies what is owned to a bike's tuning.
 *
 * Only the HIGHEST level of each part is applied, not every level up to it.
 * Stacking them compounded - three engine levels meant 1.12 x 1.22 x 1.35,
 * so 84% more torque from a part labelled "+35%" - and a fully built bike
 * looped out under its own power inside a second. A level is the state the
 * part is in, not a purchase to be added to the last one, and that is also
 * how anyone reads the labels.
 */
export function applyUpgrades(t: BikeTuning, levels: UpgradeLevels): BikeTuning {
  for (const id of BIKE_UPGRADE_IDS) {
    const owned = levels[id] ?? 0;
    if (owned > 0) UPGRADES[id].levels[owned - 1]?.apply(t);
  }
  return t;
}

/** Price of the next level, or null when it is fully built. */
export function nextLevel(id: UpgradeId, owned: number): UpgradeLevel | null {
  return UPGRADES[id].levels[owned] ?? null;
}

/** 0..1, how far through this part's levels the bike is. */
export function progressOf(id: UpgradeId, owned: number): number {
  return owned / UPGRADES[id].levels.length;
}
