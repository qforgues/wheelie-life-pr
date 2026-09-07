import { LAYOUT } from './City';

/**
 * Driving on the road grid.
 *
 * Everything in the city that drives - patrols, the bomba, the rival riders -
 * routes with these. They were the police's private methods until there was a
 * second thing that needed them, and they earned being shared the hard way:
 * every one of them exists because something drove through a building.
 *
 * The rule they all enforce is the same. **Every waypoint must share a road
 * with where the driver is standing**, so the straight line to it runs ALONG
 * that road. Hand back a junction the car is not lined up with and it sets off
 * diagonally across a block of houses.
 */

/** How far off a centreline still counts as being on that road. */
export const ROAD = LAYOUT.roadHalf + 1;

/** Keeps a grid index in range by bouncing off the edge rather than wrapping. */
export function clampIndex(i: number, len: number): number {
  if (i < 0) return 1 % len;
  if (i >= len) return Math.max(0, len - 2);
  return i;
}

/** Nearest value in a sorted-ish list - the centreline you are closest to. */
export function snap(v: number, list: readonly number[]): number {
  let best = list[0];
  let dist = Math.abs(v - best);
  for (const c of list) {
    const d = Math.abs(v - c);
    if (d < dist) { dist = d; best = c; }
  }
  return best;
}

/** Where a driver is standing, in grid terms. */
export interface OnGrid {
  /** Centreline of the nearest avenue and street, and their indices. */
  ax: number;
  sz: number;
  ai: number;
  si: number;
  onAvenue: boolean;
  onStreet: boolean;
}

export function locate(x: number, z: number): OnGrid {
  const av: readonly number[] = LAYOUT.avenueX;
  const st: readonly number[] = LAYOUT.streetZ;
  const ax = snap(x, av);
  const sz = snap(z, st);
  return {
    ax, sz,
    ai: av.indexOf(ax),
    si: st.indexOf(sz),
    onAvenue: Math.abs(x - ax) < ROAD,
    onStreet: Math.abs(z - sz) < ROAD,
  };
}

/**
 * The next junction on an aimless beat, given a roll in [0, 1).
 *
 * The caller owns the randomness so a replay stays a replay: the police and the
 * rivals each keep their own seed and neither can shift the other's.
 */
export function wanderFrom(x: number, z: number, roll: number): { x: number; z: number } {
  const av: readonly number[] = LAYOUT.avenueX;
  const st: readonly number[] = LAYOUT.streetZ;
  const g = locate(x, z);
  const dir = roll < 0.5 ? 1 : -1;

  if (g.onAvenue && g.onStreet) {
    // At a junction: turn onto the cross street, or carry on up the avenue.
    return roll < 0.5
      ? { x: g.ax, z: st[clampIndex(g.si + (roll < 0.25 ? 1 : -1), st.length)] }
      : { x: av[clampIndex(g.ai + (roll < 0.75 ? 1 : -1), av.length)], z: g.sz };
  }
  if (g.onAvenue) return { x: g.ax, z: st[clampIndex(g.si + dir, st.length)] };
  if (g.onStreet) return { x: av[clampIndex(g.ai + dir, av.length)], z: g.sz };

  // Off the grid entirely, which only happens to a car coming back from a
  // chase it broke off mid-block. Head for the nearest junction and pick the
  // beat up from there.
  return { x: g.ax, z: g.sz };
}

/**
 * The next intersection on a Manhattan route toward the target.
 *
 * Close the larger axis gap first, which on a grid is both the shortest route
 * and the one that looks like a driver making a decision.
 */
export function stepToward(
  x: number, z: number, tx: number, tz: number,
): { x: number; z: number } {
  const g = locate(x, z);
  const tax = snap(tx, LAYOUT.avenueX);
  const tsz = snap(tz, LAYOUT.streetZ);

  // Sharing a road with the target means driving straight at them. Routing to
  // the nearest junction instead was why patrols used to stall a block away
  // and never actually arrive.
  if (g.onAvenue && Math.abs(tx - g.ax) < ROAD) return { x: g.ax, z: tz };
  if (g.onStreet && Math.abs(tz - g.sz) < ROAD) return { x: tx, z: g.sz };

  // Otherwise take a leg that gets us onto one of their roads. At a junction
  // both legs are legal, so skip the one we are already standing on -
  // re-picking it is what left patrols parked at a corner.
  const legs: Array<{ x: number; z: number }> = [];
  if (g.onAvenue) legs.push({ x: g.ax, z: tsz });
  if (g.onStreet) legs.push({ x: tax, z: g.sz });

  let best: { x: number; z: number } | null = null;
  let bestDist = Infinity;
  for (const leg of legs) {
    if (Math.hypot(leg.x - x, leg.z - z) < 3) continue;
    const remaining = Math.abs(tx - leg.x) + Math.abs(tz - leg.z);
    if (remaining < bestDist) { bestDist = remaining; best = leg; }
  }
  // Off the grid entirely (shouldn't happen): head for their junction.
  return best ?? { x: tax, z: tsz };
}

/**
 * A junction to start the i-th driver on.
 *
 * Numbers the junctions 0..n-1 and strides through them by 7, which is coprime
 * with 25, so all twenty-five get used before any repeats and consecutive
 * drivers land a row and two columns apart.
 *
 * The obvious version - `av[(i * 2 + 1) % 5]` paired with `st[(i * 3 + 2) % 5]`
 * - looks like it spreads them and does not: both indices are driven by `i mod
 * 5`, so the pair repeats every five and only five of the twenty-five junctions
 * exist as far as it is concerned. Seven riders turned out on five corners,
 * two of them sharing.
 */
export function junctionByIndex(i: number): { x: number; z: number } {
  const av = LAYOUT.avenueX;
  const st = LAYOUT.streetZ;
  const n = av.length * st.length;
  const k = (Math.abs(Math.round(i)) * 7) % n;
  return { x: av[k % av.length], z: st[Math.floor(k / av.length)] };
}
