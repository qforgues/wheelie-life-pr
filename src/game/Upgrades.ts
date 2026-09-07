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
export type UpgradeId = 'engine' | 'tyres' | 'suspension' | 'weight';

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
  levels: UpgradeLevel[];
}

export const UPGRADES: Record<UpgradeId, UpgradeKind> = {
  engine: {
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
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

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
  for (const id of UPGRADE_IDS) {
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
