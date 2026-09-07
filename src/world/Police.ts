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
  /** Most patrols out at once. */
  patrols: number;
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
    patrols: 0, heatSeen: 0, heatUnseen: 0, coolPerSecond: 1, coolDelay: 0,
    sight: 0, speed: [0, 0, 0, 0], bustRange: 0, bustSeconds: 99,
    alwaysHunting: false, riotGear: false,
  },
  lazy: {
    patrols: 2, heatSeen: 0.16, heatUnseen: 0.10, coolPerSecond: 0.35, coolDelay: 3,
    sight: 90, speed: [0, 11, 14, 16], bustRange: 4.5, bustSeconds: 2.6,
    alwaysHunting: false, riotGear: false,
  },
  professional: {
    patrols: 3, heatSeen: 0.34, heatUnseen: 0.22, coolPerSecond: 0.28, coolDelay: 4,
    sight: 150, speed: [0, 15, 19, 23], bustRange: 5.5, bustSeconds: 1.4,
    alwaysHunting: false, riotGear: false,
  },
  aggressive: {
    patrols: 3, heatSeen: 0.60, heatUnseen: 0.34, coolPerSecond: 0.22, coolDelay: 6,
    sight: 210, speed: [0, 20, 24, 28], bustRange: 6.5, bustSeconds: 1.0,
    alwaysHunting: false, riotGear: false,
  },
  ice: {
    patrols: 3, heatSeen: 0.85, heatUnseen: 0.60, coolPerSecond: 0.18, coolDelay: 8,
    sight: 300, speed: [0, 25, 29, 33], bustRange: 7.5, bustSeconds: 0.7,
    alwaysHunting: true, riotGear: true,
  },
};

export function isPoliceStyle(v: unknown): v is PoliceStyle {
  return typeof v === 'string' && (POLICE_ORDER as string[]).includes(v);
}

/** Cops give up beyond this whatever the style. */
const GIVE_UP = 280;

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
}

export interface PoliceReport {
  heat: HeatLevel;
  /** Rising edge of level 1 - the one warning you get. */
  warned: boolean;
  busted: boolean;
  /** Live positions, for the minimap. */
  blips: Array<{ x: number; z: number }>;
}

export class Police {
  readonly root = new THREE.Group();

  private patrols: Patrol[] = [];
  private heat = 0;
  private bustTimer = 0;
  private hasWarned = false;
  private flash = 0;
  private cleanFor = 0;
  private report: PoliceReport = { heat: 0, warned: false, busted: false, blips: [] };
  private style: PoliceStyle = 'professional';
  private tuning: StyleTuning = STYLES.professional;

  constructor() {
    // Three is the ceiling from the interview. They are built once and parked
    // off-duty rather than spawned, so heat rising never costs a frame hitch.
    for (let i = 0; i < 3; i++) {
      const { group, lights } = makePoliceCar();
      group.visible = false;
      this.root.add(group);
      this.patrols.push({
        group, lights, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, active: false,
      });
    }
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
    const wasRiot = this.tuning.riotGear;
    this.style = style;
    this.tuning = STYLES[style];
    this.reset();
    if (this.tuning.riotGear !== wasRiot) this.rebuild();
    this.root.visible = style !== 'none';
  }

  private rebuild(): void {
    for (const p of this.patrols) this.root.remove(p.group);
    this.patrols = [];
    for (let i = 0; i < 3; i++) {
      const { group, lights } = makePoliceCar(this.tuning.riotGear);
      group.visible = false;
      this.root.add(group);
      this.patrols.push({ group, lights, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, active: false });
    }
  }

  get heatLevel(): HeatLevel {
    return Math.min(this.tuning.patrols, Math.floor(this.heat)) as HeatLevel;
  }

  reset(): void {
    this.heat = 0;
    this.bustTimer = 0;
    this.cleanFor = 0;
    this.hasWarned = false;
    for (const p of this.patrols) {
      p.active = false;
      p.group.visible = false;
    }
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

    this.deploy(level, px, pz);
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

    this.flash += dt * 9;
    const on = Math.sin(this.flash) > 0;
    for (const p of this.patrols) {
      if (!p.active) continue;
      (p.lights[0].material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.4 : 0.15;
      (p.lights[1].material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 0.15 : 2.4;
    }

    r.heat = level;
    r.blips = this.patrols.filter((p) => p.active).map((p) => ({ x: p.x, z: p.z }));
    return r;
  }

  private nearestDistance(px: number, pz: number): number {
    let best = Infinity;
    for (const p of this.patrols) {
      if (!p.active) continue;
      best = Math.min(best, Math.hypot(p.x - px, p.z - pz));
    }
    return best;
  }

  /** Brings patrols on and off duty to match the heat level. */
  private deploy(level: number, px: number, pz: number): void {
    for (let i = 0; i < this.patrols.length; i++) {
      const p = this.patrols[i];
      const wanted = i < level;
      if (wanted === p.active) continue;
      p.active = wanted;
      p.group.visible = wanted;
      if (!wanted) continue;
      // Arrive from a junction a couple of blocks away, never on top of you.
      const spawn = this.junctionNear(px, pz, 150 + i * 40);
      p.x = spawn.x;
      p.z = spawn.z;
      p.tx = spawn.x;
      p.tz = spawn.z;
    }
  }

  private drive(dt: number, px: number, pz: number, level: number): void {
    const speed = this.tuning.speed[level] ?? 0;
    for (const p of this.patrols) {
      if (!p.active) continue;

      // Re-target whenever the current waypoint is reached. Waypoints are grid
      // intersections, so a patrol always drives on a road - chasing in a
      // straight line would send them through the middle of a block.
      if (Math.hypot(p.tx - p.x, p.tz - p.z) < 3) {
        const next = this.stepToward(p.x, p.z, px, pz);
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
    }
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

  /** A junction roughly `away` metres from the rider, to arrive from. */
  private junctionNear(px: number, pz: number, away: number): { x: number; z: number } {
    let best: { x: number; z: number } = { x: LAYOUT.avenueX[0], z: LAYOUT.streetZ[0] };
    let bestErr = Infinity;
    for (const ax of LAYOUT.avenueX) {
      for (const sz of LAYOUT.streetZ) {
        const err = Math.abs(Math.hypot(ax - px, sz - pz) - away);
        if (err < bestErr) { bestErr = err; best = { x: ax, z: sz }; }
      }
    }
    return best;
  }

  /** True if a patrol is physically on top of the bike - a real collision. */
  hits(x: number, z: number, r: number): boolean {
    for (const p of this.patrols) {
      if (!p.active) continue;
      // Patrols are rotated, so use the larger half-extent both ways rather
      // than pretend they are axis-aligned. Slightly generous, and forgiving
      // is the right way to be wrong about a collision you did not choose.
      const half = Math.max(CAR_HALF.x, CAR_HALF.z) * 0.8;
      if (Math.abs(x - p.x) < half + r && Math.abs(z - p.z) < half + r) return true;
    }
    return false;
  }
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

