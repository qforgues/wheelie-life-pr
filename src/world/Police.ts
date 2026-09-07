import * as THREE from 'three';
import { makePoliceCar, CAR_HALF } from './Props';
import { LAYOUT } from './City';

/**
 * La policía.
 *
 * From Justin's interview: police that warn you first, three levels of heat,
 * and cops shown on the minimap once you have bought a scanner.
 *
 * The rule that makes this fun rather than punishing is that **wheelieing is
 * what they care about**. Riding normally is free. Heat climbs while the front
 * wheel is up and only while a patrol can plausibly see you, so a long wheelie
 * down a main road is a risk you are choosing to take, and ducking down a side
 * street to let it cool is a real tactic rather than a loading screen.
 *
 * Cops route along the road grid rather than driving through buildings. They
 * are not fast enough to catch a bike that keeps moving - being caught is
 * almost always the result of stopping, crashing, or dead-ending yourself.
 */

export type HeatLevel = 0 | 1 | 2 | 3;

/** How hard the police play. Justin's ladder. */
export type PoliceStyle = 'none' | 'lazy' | 'professional' | 'aggressive' | 'ice';

export const POLICE_ORDER: PoliceStyle[] = ['none', 'lazy', 'professional', 'aggressive', 'ice'];

export const POLICE_LABELS: Record<PoliceStyle, string> = {
  none: 'NONE',
  lazy: 'LAZY',
  professional: 'PRO',
  aggressive: 'AGGRO',
  ice: 'ICE',
};

export const POLICE_BLURBS: Record<PoliceStyle, string> = {
  none: 'Nobody is watching. Wheelie all day.',
  lazy: 'They notice eventually, and give up quickly.',
  professional: 'One warning, then they work the grid properly.',
  aggressive: 'Three cars, no patience, and they drive hard.',
  ice: 'Riot gear. They come for you whether you did anything or not.',
};

interface StyleTuning {
  /**
   * Cars on shift: patrols cruising the grid whether or not anyone is wanted.
   *
   * Police used to exist only once heat was up, which meant a city with no
   * police in it - you could ride for ten minutes and never see one. They are
   * scenery first and a threat second, and the tier decides how many are out.
   */
  shift: number;
  /** Most of that shift that will ever break off to chase you at once. */
  maxChasers: number;
  /** Speed while cruising a beat, as opposed to chasing. */
  cruise: number;
  /** Heat per second of wheelie, in sight of a patrol and out of it. */
  heatSeen: number;
  heatUnseen: number;
  coolPerSecond: number;
  /**
   * Seconds of clean riding before heat starts falling at all.
   *
   * Without this the maths quietly made police impossible: heat rose at 0.14/s
   * and fell at 0.22/s, so you had to be wheelieing 61% of the time merely to
   * break even, and a real rider doing three seconds up and five down never saw
   * a single patrol. Interest should linger after they have noticed you.
   */
  coolDelay: number;
  /** How far a patrol can see, and how fast it drives at each heat level. */
  sight: number;
  speed: number[];
  bustRange: number;
  bustSeconds: number;
  /**
   * ICE only: heat climbs whether or not you are doing anything wrong, so the
   * only way out is distance. Everyone else needs a reason to chase you.
   */
  alwaysHunting: boolean;
  riotGear: boolean;
}

const STYLES: Record<PoliceStyle, StyleTuning> = {
  none: {
    shift: 0, maxChasers: 0, cruise: 0, heatSeen: 0, heatUnseen: 0, coolPerSecond: 1, coolDelay: 0,
    sight: 0, speed: [0, 0, 0, 0], bustRange: 0, bustSeconds: 99,
    alwaysHunting: false, riotGear: false,
  },
  lazy: {
    shift: 3, maxChasers: 1, cruise: 10, heatSeen: 0.16, heatUnseen: 0.10, coolPerSecond: 0.35, coolDelay: 3,
    sight: 90, speed: [0, 11, 14, 16], bustRange: 4.5, bustSeconds: 2.6,
    alwaysHunting: false, riotGear: false,
  },
  professional: {
    shift: 6, maxChasers: 3, cruise: 12, heatSeen: 0.34, heatUnseen: 0.22, coolPerSecond: 0.28, coolDelay: 4,
    sight: 150, speed: [0, 15, 19, 23], bustRange: 5.5, bustSeconds: 1.4,
    alwaysHunting: false, riotGear: false,
  },
  aggressive: {
    shift: 9, maxChasers: 5, cruise: 14, heatSeen: 0.60, heatUnseen: 0.34, coolPerSecond: 0.22, coolDelay: 6,
    sight: 210, speed: [0, 20, 24, 28], bustRange: 6.5, bustSeconds: 1.0,
    alwaysHunting: false, riotGear: false,
  },
  ice: {
    shift: 12, maxChasers: 8, cruise: 16, heatSeen: 0.85, heatUnseen: 0.60, coolPerSecond: 0.18, coolDelay: 8,
    sight: 300, speed: [0, 25, 29, 33], bustRange: 7.5, bustSeconds: 0.7,
    alwaysHunting: true, riotGear: true,
  },
};

export function isPoliceStyle(v: unknown): v is PoliceStyle {
  return typeof v === 'string' && (POLICE_ORDER as string[]).includes(v);
}

/** Cops give up beyond this whatever the style. */
const GIVE_UP = 280;
/** Patrols past this are still driving, just not drawn. */
const DRAW_RADIUS = 260;

interface Patrol {
  group: THREE.Group;
  lights: [THREE.Mesh, THREE.Mesh];
  x: number;
  z: number;
  yaw: number;
  /** Grid intersection currently being driven to. */
  tx: number;
  tz: number;
  active: boolean;
  /** Cruising a beat, or coming for you. */
  chasing: boolean;
}

export interface PoliceReport {
  heat: HeatLevel;
  /** How many of the shift are actively chasing. */
  chasers: number;
  /** Rising edge of level 1 - the one warning you get. */
  warned: boolean;
  busted: boolean;
  /** Live positions, for the minimap. */
  blips: Array<{ x: number; z: number; chasing: boolean }>;
}

export class Police {
  readonly root = new THREE.Group();

  private patrols: Patrol[] = [];
  private heat = 0;
  private bustTimer = 0;
  private hasWarned = false;
  private flash = 0;
  private cleanFor = 0;
  private litLastFrame = false;
  private wanderSeed = 9127;
  private report: PoliceReport = { heat: 0, chasers: 0, warned: false, busted: false, blips: [] };
  private style: PoliceStyle = 'professional';
  private tuning: StyleTuning = STYLES.professional;

  constructor() {
    this.rebuild();
  }

  /** Builds a shift of the right size and livery for the current style. */
  private rebuild(): void {
    for (const p of this.patrols) this.root.remove(p.group);
    this.patrols = [];
    for (let i = 0; i < this.tuning.shift; i++) {
      const { group, lights } = makePoliceCar(this.tuning.riotGear);
      const start = this.junctionByIndex(i);
      group.position.set(start.x, 0, start.z);
      this.root.add(group);
      this.patrols.push({
        group, lights,
        x: start.x, z: start.z, yaw: 0,
        tx: start.x, tz: start.z,
        active: true, chasing: false,
      });
    }
  }

  /** Spreads the shift across the grid so they don't all start on one corner. */
  private junctionByIndex(i: number): { x: number; z: number } {
    const av = LAYOUT.avenueX;
    const st = LAYOUT.streetZ;
    // Stride by a coprime-ish step so successive patrols land far apart.
    return { x: av[(i * 2 + 1) % av.length], z: st[(i * 3 + 2) % st.length] };
  }

  get styleName(): PoliceStyle {
    return this.style;
  }

  /**
   * Switches how hard they play. Rebuilds the cars, because riot units look
   * different and there is no point paying for that geometry until ICE is on.
   */
  setStyle(style: PoliceStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.tuning = STYLES[style];
    this.heat = 0;
    this.bustTimer = 0;
    this.cleanFor = 0;
    this.hasWarned = false;
    // The shift size and the livery both change, so the cars are rebuilt.
    this.rebuild();
    this.root.visible = style !== 'none';
  }

  get heatLevel(): HeatLevel {
    return Math.min(3, Math.floor(this.heat)) as HeatLevel;
  }

  /** Drops the heat. The shift stays on the road - they are always out there. */
  reset(): void {
    this.heat = 0;
    this.bustTimer = 0;
    this.cleanFor = 0;
    this.hasWarned = false;
    for (const p of this.patrols) p.chasing = false;
  }

  /**
   * @param wheelieing whether the front wheel is currently up.
   * @param riding     false while crashed, so heat can't climb off a wreck.
   */
  update(
    dt: number, px: number, pz: number, wheelieing: boolean, riding: boolean,
  ): PoliceReport {
    const r = this.report;
    r.warned = false;
    r.busted = false;
    if (this.style === 'none') {
      r.heat = 0;
      r.blips.length = 0;
      return r;
    }

    const t = this.tuning;
    const nearest = this.nearestDistance(px, pz);
    const seen = nearest < t.sight;

    // ICE does not need a reason. Everyone else is only interested while the
    // front wheel is up, which is what makes a wheelie down a main road a
    // choice rather than a tax.
    const wanted = riding && (wheelieing || t.alwaysHunting);

    if (wanted) {
      this.cleanFor = 0;
      this.heat = Math.min(3.999, this.heat + (seen ? t.heatSeen : t.heatUnseen) * dt);
    } else {
      this.cleanFor += dt;
      // Their interest lingers. Only once you have been clean for a while does
      // it start to fade - and slower still while a patrol has eyes on you.
      if (this.cleanFor > t.coolDelay) {
        const rate = seen && nearest < GIVE_UP ? t.coolPerSecond * 0.4 : t.coolPerSecond;
        this.heat = Math.max(0, this.heat - rate * dt);
      }
    }

    const level = this.heatLevel;
    if (level >= 1 && !this.hasWarned) {
      this.hasWarned = true;
      r.warned = true;
    }
    if (level === 0) this.hasWarned = false;

    const chasers = this.deploy(level, px, pz);
    this.drive(dt, px, pz, level);

    // Getting caught: a patrol on top of you, for long enough to stop.
    if (level > 0 && riding && this.nearestDistance(px, pz) < t.bustRange) {
      this.bustTimer += dt;
      if (this.bustTimer >= t.bustSeconds) {
        r.busted = true;
        this.reset();
      }
    } else {
      this.bustTimer = Math.max(0, this.bustTimer - dt * 1.5);
    }

    // Lights only run on a chase. A patrol on its beat is just a car, which is
    // what makes seeing one light up mean something.
    this.flash += dt * 9;
    const on = Math.sin(this.flash) > 0;
    const anyChasing = this.patrols.some((p) => p.chasing);
    if (anyChasing || this.litLastFrame) {
      for (const p of this.patrols) {
        const a = p.chasing && on ? 2.4 : 0.12;
        const b = p.chasing && !on ? 2.4 : 0.12;
        (p.lights[0].material as THREE.MeshStandardMaterial).emissiveIntensity = a;
        (p.lights[1].material as THREE.MeshStandardMaterial).emissiveIntensity = b;
      }
      this.litLastFrame = anyChasing;
    }

    r.heat = level;
    r.chasers = chasers;
    r.blips = this.patrols.map((p) => ({ x: p.x, z: p.z, chasing: p.chasing }));
    return r;
  }

  private nearestDistance(px: number, pz: number): number {
    let best = Infinity;
    for (const p of this.patrols) {
      best = Math.min(best, Math.hypot(p.x - px, p.z - pz));
    }
    return best;
  }

  /**
   * Decides which of the shift break off to chase.
   *
   * The nearest ones do, which is both the obvious behaviour and the one that
   * makes the city feel joined up: the car you just rode past is the car that
   * comes after you.
   */
  private deploy(level: number, px: number, pz: number): number {
    const wanted = level === 0
      ? 0
      : Math.max(1, Math.round((level / 3) * this.tuning.maxChasers));

    const byRange = [...this.patrols]
      .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    byRange.forEach((p, i) => { p.chasing = i < wanted; });
    return Math.min(wanted, this.patrols.length);
  }

  private drive(dt: number, px: number, pz: number, level: number): void {
    const chaseSpeed = this.tuning.speed[level] ?? this.tuning.cruise;

    for (const p of this.patrols) {
      const speed = p.chasing ? chaseSpeed : this.tuning.cruise;

      // Re-target whenever the current waypoint is reached. Waypoints are grid
      // intersections, so a patrol always drives on a road - chasing in a
      // straight line would send them through the middle of a block.
      if (Math.hypot(p.tx - p.x, p.tz - p.z) < 3) {
        const next = p.chasing
          ? this.stepToward(p.x, p.z, px, pz)
          : this.wander(p);
        p.tx = next.x;
        p.tz = next.z;
      }

      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) {
        const step = Math.min(d, speed * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        p.yaw = Math.atan2(dx, dz);
      }
      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = p.yaw;

      // Off-duty geometry still costs a draw call, so stop drawing the far half
      // of the shift - especially on ICE, where there are twelve of them.
      const far = Math.hypot(p.x - px, p.z - pz);
      p.group.visible = far < DRAW_RADIUS;
    }
  }

  /**
   * A patrol working its beat: drive to a neighbouring junction, then another.
   *
   * Deliberately aimless. A patrol that drifted toward the player without
   * chasing would read as buggy rather than watchful, and the whole point of
   * the shift is that they are going about their business until you give them
   * a reason not to.
   */
  private wander(p: Patrol): { x: number; z: number } {
    const av: readonly number[] = LAYOUT.avenueX;
    const st: readonly number[] = LAYOUT.streetZ;
    const ai = av.indexOf(snap(p.x, av));
    const si = st.indexOf(snap(p.z, st));
    this.wanderSeed = (this.wanderSeed * 1664525 + 1013904223) >>> 0;
    const roll = this.wanderSeed / 4294967296;
    // Turn or carry on, one block at a time.
    if (roll < 0.5) {
      const step = roll < 0.25 ? 1 : -1;
      return { x: av[clampIndex(ai + step, av.length)], z: st[si] ?? p.z };
    }
    const step = roll < 0.75 ? 1 : -1;
    return { x: av[ai] ?? p.x, z: st[clampIndex(si + step, st.length)] };
  }

  /**
   * The next intersection on a Manhattan route toward the target.
   *
   * Close the larger axis gap first, which on a grid is both the shortest route
   * and the one that looks like a driver making a decision.
   */
  private stepToward(x: number, z: number, tx: number, tz: number): { x: number; z: number } {
    const ax = snap(x, LAYOUT.avenueX);
    const sz = snap(z, LAYOUT.streetZ);
    const tax = snap(tx, LAYOUT.avenueX);
    const tsz = snap(tz, LAYOUT.streetZ);
    const ROAD = LAYOUT.roadHalf + 1;

    const onAvenue = Math.abs(x - ax) < ROAD;
    const onStreet = Math.abs(z - sz) < ROAD;

    // Sharing a road with the rider means driving straight at them. Routing to
    // the nearest junction instead was why patrols used to stall a block away
    // and never actually arrive.
    if (onAvenue && Math.abs(tx - ax) < ROAD) return { x: ax, z: tz };
    if (onStreet && Math.abs(tz - sz) < ROAD) return { x: tx, z: sz };

    // Otherwise take a leg that gets us onto one of their roads. At a junction
    // both legs are legal, so skip the one we are already standing on -
    // re-picking it is what left patrols parked at a corner.
    const legs: Array<{ x: number; z: number }> = [];
    if (onAvenue) legs.push({ x: ax, z: tsz });
    if (onStreet) legs.push({ x: tax, z: sz });

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

  /** True if a patrol is physically on top of the bike - a real collision. */
  hits(x: number, z: number, r: number): boolean {
    for (const p of this.patrols) {
      // Patrols are rotated, so use the larger half-extent both ways rather
      // than pretend they are axis-aligned. Slightly generous, and forgiving
      // is the right way to be wrong about a collision you did not choose.
      const half = Math.max(CAR_HALF.x, CAR_HALF.z) * 0.8;
      if (Math.abs(x - p.x) < half + r && Math.abs(z - p.z) < half + r) return true;
    }
    return false;
  }
}

/** Keeps a grid index in range by bouncing off the edge rather than wrapping. */
function clampIndex(i: number, len: number): number {
  if (i < 0) return 1 % len;
  if (i >= len) return Math.max(0, len - 2);
  return i;
}

function snap(v: number, list: readonly number[]): number {
  let best = list[0];
  let dist = Math.abs(v - best);
  for (const c of list) {
    const d = Math.abs(v - c);
    if (d < dist) { dist = d; best = c; }
  }
  return best;
}

