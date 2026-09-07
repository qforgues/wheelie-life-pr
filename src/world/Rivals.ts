import * as THREE from 'three';
import { makeRivalBike, type RivalLook, type RivalModel } from './Props';
import { junctionByIndex, stepToward, wanderFrom } from './grid';
import type { OutfitId } from '../game/Outfits';

/**
 * Other people out riding.
 *
 * Justin picked this off the list first, and he was right to: the city had
 * traffic, police and pedestrians in it, and not one other person doing the
 * thing the game is about. A rival is not an obstacle and not an enemy - they
 * are somebody riding the same streets who is also up on the back wheel, and
 * the whole point is that you can catch them at it.
 *
 * They route the grid with the same helpers the police use (world/grid.ts), so
 * they stay on the road by construction, and they hold a lane inboard of the
 * traffic - which is where somebody wheelieing actually rides.
 *
 * This is the foundation for wheelie battles. It deliberately stops short of
 * being one: no wagers, no scoring against them yet. First they have to exist,
 * have names, and be worth riding over to.
 */

export type RivalCount = 'off' | 'few' | 'crew';

export const RIVAL_ORDER: RivalCount[] = ['off', 'few', 'crew'];

export const RIVAL_LABELS: Record<RivalCount, string> = {
  off: 'OFF',
  few: 'FEW',
  crew: 'CREW',
};

export const RIVAL_BLURBS: Record<RivalCount, string> = {
  off: 'Empty streets. Just you.',
  few: 'Three of them out. You will run into somebody.',
  crew: 'Los Piratas are all out. Expect company.',
};

/** How many riders are out at each setting. */
const RIVAL_SHIFT: Record<RivalCount, number> = { off: 0, few: 3, crew: 7 };

export function isRivalCount(v: unknown): v is RivalCount {
  return typeof v === 'string' && (RIVAL_ORDER as string[]).includes(v);
}

/**
 * How somebody rides.
 *
 * Three temperaments is enough to tell them apart from a block away: one who
 * is up on the wheel constantly, one who only does it flat out, and one who is
 * clearly still learning.
 */
type Temper = 'hooligan' | 'racer' | 'learner';

interface TemperTuning {
  /** Metres per second on the street. */
  cruise: number;
  /** Seconds between attempts. */
  rest: [number, number];
  /** Seconds they can hold one. */
  hold: [number, number];
  /** How high they carry it (rad). The balance point is about 1.0. */
  height: number;
  /** How much they wobble on the way. A learner is not smooth. */
  wobble: number;
}

const TEMPERS: Record<Temper, TemperTuning> = {
  hooligan: { cruise: 15, rest: [2.5, 5], hold: [4, 9], height: 0.92, wobble: 0.05 },
  racer: { cruise: 21, rest: [7, 13], hold: [2.5, 5], height: 0.72, wobble: 0.03 },
  learner: { cruise: 11, rest: [3, 7], hold: [0.8, 2.2], height: 0.58, wobble: 0.12 },
};

/**
 * Los Piratas.
 *
 * Justin gets to name these properly and say who they are - that is his job on
 * the list. Until then they are five riders and two hangers-on with enough
 * character each to tell apart, which is what the code needs to be right.
 */
interface RivalSpec {
  name: string;
  temper: Temper;
  look: RivalLook;
  /**
   * How good they are, 0..1. This is what the wager broker prices the bet on,
   * so it has to line up with how they actually ride - a hooligan who holds one
   * for nine seconds is not a soft touch and should not be priced like one.
   */
  skill: number;
  /** What they have in the closet, and could lose to you. */
  wearing: OutfitId | null;
}

const DIRT = { style: 'dirt' as const, frontRadius: 0.347, rearRadius: 0.331, hipHeight: 1.02, seatZ: 0.60 };
const MINI = { style: 'mini' as const, frontRadius: 0.24, rearRadius: 0.24, hipHeight: 0.88, seatZ: 0.40 };
const SPORT = { style: 'sport' as const, frontRadius: 0.300, rearRadius: 0.336, hipHeight: 0.90, seatZ: 0.56 };

const CREW: RivalSpec[] = [
  { name: 'PIRAÑA', skill: 0.72, wearing: 'piratas', temper: 'hooligan', look: { ...DIRT, bodyColor: 0x1b45b4, kitColor: 0xe23c2c } },
  { name: 'LA SOMBRA', skill: 0.66, wearing: 'piratas', temper: 'racer', look: { ...SPORT, bodyColor: 0x16171b, kitColor: 0xd8dce4 } },
  { name: 'TITO', skill: 0.22, wearing: null, temper: 'learner', look: { ...MINI, bodyColor: 0xe0a13a, kitColor: 0x2f6f4f } },
  { name: 'CHUCHÍN', skill: 0.70, wearing: 'piratas', temper: 'hooligan', look: { ...DIRT, bodyColor: 0xf2f4f7, kitColor: 0x1f8f5a } },
  { name: 'MELO', skill: 0.26, wearing: null, temper: 'learner', look: { ...MINI, bodyColor: 0xc4161c, kitColor: 0x2a3a6a } },
  { name: 'NENA', skill: 0.61, wearing: 'piratas', temper: 'racer', look: { ...SPORT, bodyColor: 0x8a3fc0, kitColor: 0xf2c14e } },
  { name: 'EL FLACO', skill: 0.68, wearing: 'piratas', temper: 'hooligan', look: { ...DIRT, bodyColor: 0x1f8f5a, kitColor: 0x16171b } },
];

/** What they shout when you come alongside. */
const HELLOS = ['¡DALE!', '¡SUBE ESA!', '¡WEPA!', '¡ESO ES!', '¡ARRIBA!'];

interface Rider {
  spec: RivalSpec;
  model: RivalModel;
  x: number;
  z: number;
  /** True heading, which is straight at the waypoint. */
  course: number;
  /** Drawn heading, which lags the course so the bike leans into a corner. */
  yaw: number;
  tx: number;
  tz: number;
  /**
   * Where they are actually drawn: the routing position pushed out into their
   * lane. Everything the player can see or hit uses this; only the routing uses
   * the centreline. Reporting the centreline instead put the map blip and the
   * collision box in a different place from the bike.
   */
  drawX: number;
  drawZ: number;
  /** Metres covered on the current leg, which is what eases the lane offset. */
  legTravel: number;
  /** 0 while down, 1 while fully up. */
  loft: number;
  /** Seconds left of the current attempt, or of the rest before the next. */
  timer: number;
  up: boolean;
  /** Metres of the run they are on, and their best of the session. */
  run: number;
  best: number;
  spin: number;
  frontSpin: number;
  /** Slow clock, only for the wobble. */
  phase: number;
  /** In a battle with the player, and trying. */
  racing: boolean;
  /** Stops them greeting you every frame you ride alongside. */
  greeted: number;
}

/** One rider you are alongside, and what they shouted. */
export interface RivalHail {
  name: string;
  line: string;
  /** Metres they were holding when you came past, 0 if they were down. */
  wheelie: number;
}

/** Somebody you have just made contact with, which is what starts a battle. */
export interface RivalContact {
  index: number;
  name: string;
  skill: number;
  wearing: OutfitId | null;
}

export interface RivalReport {
  hail: RivalHail | null;
  blips: Array<{ x: number; z: number }>;
  /**
   * Justin's trigger: a battle starts when you and a crew **make contact**.
   * Set for the one frame the bike touches somebody, and then not again until
   * you have separated - otherwise leaning on a rival at a set of lights opens
   * the prompt sixty times a second.
   */
  contact: RivalContact | null;
}

/**
 * How far right of the centreline they ride.
 *
 * A road here is 12 m wide with a car lane each way at 2.3 m off the centre, so
 * a car occupies 1.35-3.25 m out and there are two clear channels: the middle,
 * and the strip between the traffic and the kerb. The rivals take the outside
 * one, which is both where you actually ride past a line of cars and the only
 * choice that leaves the whole middle of the road to the player. Putting them
 * inboard read better standing still and meant clipping one every time you
 * rode down the centre.
 */
const LANE = 4.3;
/** Past this they are still riding, just not drawn. */
const DRAW_RADIUS = 220;
/** Come this close and they will say something. */
const HAIL_RANGE = 22;
/** And this close counts as making contact, which is what starts a battle. */
const CONTACT_RANGE = 2.6;
/** And not again for this long. */
const HAIL_COOL = 14;
/**
 * Past this from the player, a rider's next waypoint routes toward you instead
 * of being picked at random.
 *
 * Without it, seven riders on a 480 x 640 m grid is seven riders you never
 * meet. This is not homing - they still take a junction at a time, at their own
 * pace, and once they are inside the radius they go back to riding wherever
 * they like. It just means the crew drifts toward the action.
 */
const GATHER = 250;
/** Bikes are narrow - this is bar width, not car width. */
const RIVAL_HALF = 0.42;

export class Rivals {
  readonly root = new THREE.Group();

  private riders: Rider[] = [];
  private setting: RivalCount = 'few';
  private seed = 4471;
  private report: RivalReport = { hail: null, blips: [], contact: null };
  /** Index of whoever we are currently leaning on, so contact fires once. */
  private touching = -1;
  /** Set while a battle is on, so the crew stop being solid mid-race. */
  battling = false;

  constructor() {
    this.rebuild();
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private between(range: [number, number]): number {
    return range[0] + this.rnd() * (range[1] - range[0]);
  }

  get count(): RivalCount {
    return this.setting;
  }

  setCount(c: RivalCount): void {
    if (c === this.setting) return;
    this.setting = c;
    this.rebuild();
  }

  private rebuild(): void {
    for (const r of this.riders) this.root.remove(r.model.group);
    this.riders = [];
    const want = RIVAL_SHIFT[this.setting];

    for (let i = 0; i < want; i++) {
      const spec = CREW[i % CREW.length];
      const model = makeRivalBike(spec.look);
      // Spread them over the grid rather than turning them all out on one
      // corner - the same stride the shift uses.
      const start = junctionByIndex(i * 3 + 1);
      const rider: Rider = {
        spec,
        model,
        x: start.x,
        z: start.z,
        course: 0,
        yaw: 0,
        tx: start.x,
        tz: start.z,
        drawX: start.x,
        drawZ: start.z,
        legTravel: 0,
        loft: 0,
        timer: this.between(TEMPERS[spec.temper].rest),
        up: false,
        run: 0,
        best: 0,
        spin: 0,
        frontSpin: 0,
        phase: 0,
        racing: false,
        greeted: 0,
      };
      const next = wanderFrom(rider.x, rider.z, this.rnd());
      rider.tx = next.x;
      rider.tz = next.z;
      rider.course = Math.atan2(next.x - rider.x, next.z - rider.z);
      rider.yaw = rider.course;
      this.root.add(model.group);
      this.riders.push(rider);
    }
  }

  reset(): void {
    for (const r of this.riders) {
      r.loft = 0;
      r.up = false;
      r.run = 0;
      r.racing = false;
      r.greeted = 0;
      r.timer = this.between(TEMPERS[r.spec.temper].rest);
    }
  }

  /**
   * Moves anybody sitting on a respawn point out of the way.
   *
   * The police taught this lesson expensively: respawning inside somebody is a
   * crash you did not cause, and it repeats. Rivals are always moving, so all
   * this needs to do is send them on down the road they were already taking.
   */
  clearAround(x: number, z: number, radius = 16): void {
    for (const r of this.riders) {
      if (Math.hypot(r.drawX - x, r.drawZ - z) > radius) continue;
      const dx = r.tx - r.x;
      const dz = r.tz - r.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.001) continue;
      const push = radius + 6;
      r.x += (dx / d) * Math.min(push, d);
      r.z += (dz / d) * Math.min(push, d);
      r.model.group.position.set(r.drawX, 0, r.drawZ);
      // And put the wheel down: a rival looping in on top of you is not the
      // first thing you should see after a crash.
      r.up = false;
      r.timer = this.between(TEMPERS[r.spec.temper].rest);
    }
  }

  /** Who a rider is, for pricing a wager against them. */
  specFor(i: number): { name: string; skill: number; wearing: OutfitId | null } | null {
    const r = this.riders[i];
    return r ? { name: r.spec.name, skill: r.spec.skill, wearing: r.spec.wearing } : null;
  }

  /**
   * Puts one rider into race mode, or takes them out of it.
   *
   * They already wheelie on their own schedule; racing shortens the rest
   * between goes and stretches the holds, so they are visibly trying. Without
   * it a battle against a learner is sixty seconds of watching somebody potter.
   */
  race(i: number, on: boolean): void {
    const r = this.riders[i];
    if (!r) return;
    r.racing = on;
    if (on) {
      r.timer = 0.4;
      r.up = false;
    }
  }

  /** Live state of one rider, for a battle to score against. */
  riderState(i: number): { up: boolean; run: number; x: number; z: number } | null {
    const r = this.riders[i];
    if (!r) return null;
    return { up: r.up, run: r.run, x: r.drawX, z: r.drawZ };
  }

  /** Their best runs this session, longest first - for a leaderboard later. */
  get standings(): Array<{ name: string; best: number }> {
    return this.riders
      .map((r) => ({ name: r.spec.name, best: r.best }))
      .sort((a, b) => b.best - a.best);
  }

  update(dt: number, px: number, pz: number): RivalReport {
    this.report.hail = null;
    this.report.contact = null;
    this.report.blips.length = 0;
    if (this.setting === 'off') return this.report;

    for (let i = 0; i < this.riders.length; i++) {
      const r = this.riders[i];
      const t = TEMPERS[r.spec.temper];
      this.think(r, t, dt);

      // ---- route ----------------------------------------------------------
      if (Math.hypot(r.tx - r.x, r.tz - r.z) < 3) {
        // Land exactly on the junction before setting off from it.
        //
        // Arriving within three metres and leaving from wherever that was
        // carries the error into the next leg, which then runs three metres to
        // one side of the centreline all the way down the block. On a patrol
        // that is invisible; with a 4.3 m lane offset on top it put a wheel on
        // the pavement, which is exactly what the harness caught. Snapping
        // costs a fifth of a second of travel, at a corner, where the bike is
        // turning anyway.
        r.x = r.tx;
        r.z = r.tz;
        // Riders drift toward whoever else is out. See GATHER.
        const far = Math.hypot(px - r.x, pz - r.z) > GATHER;
        const next = far ? stepToward(r.x, r.z, px, pz) : wanderFrom(r.x, r.z, this.rnd());
        r.tx = next.x;
        r.tz = next.z;
        r.legTravel = 0;
      }
      const dx = r.tx - r.x;
      const dz = r.tz - r.z;
      const d = Math.hypot(dx, dz);

      // Speed: a wheelie is not flat out.
      const speed = t.cruise * (r.up ? 0.82 : 1);
      let applied = 0;
      if (d > 0.001) {
        const step = Math.min(d, speed * dt);
        r.x += (dx / d) * step;
        r.z += (dz / d) * step;
        r.course = Math.atan2(dx, dz);
        r.legTravel += step;
        if (r.up) r.run += step;

        // The bike's POSITION follows the leg to the junction exactly, so it
        // cannot leave the road. Only the drawn heading lags, which is what
        // makes it lean into a corner and stand up out of it. Limiting the
        // position instead is how the patrols used to end up in a building.
        let turn = r.course - r.yaw;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        const maxTurn = 2.6 * dt;
        applied = Math.max(-maxTurn, Math.min(maxTurn, turn));
        r.yaw += applied;
      }

      // ---- place ----------------------------------------------------------
      // Facing +Z, a rider's right hand is -X (see the roll sign note in
      // BikeSim), so the right of travel is (-cos, +sin) of the heading. The
      // offset is taken off the COURSE, not the drawn yaw: the course runs
      // exactly along the road, and using the yaw - which lags through a corner
      // - swung them 7.2 m off the centreline and onto the pavement.
      //
      // It also eases to nothing at each end of the leg, because 4.3 m right of
      // one road is 4.3 m right of a different road the moment they turn, and
      // crossing a junction on the outside line is both a jump and wrong. A
      // rider cuts to the middle through a corner and drifts back out. This is
      // that, and it is what keeps them inside the kerbs at every junction.
      const cx = Math.sin(r.course);
      const cz = Math.cos(r.course);
      const ease = Math.min(1, r.legTravel / 14, Math.max(0, d - 2) / 14);
      r.drawX = r.x - cz * LANE * ease;
      r.drawZ = r.z + cx * LANE * ease;
      const g = r.model.group;
      g.position.set(r.drawX, 0, r.drawZ);
      g.rotation.y = r.yaw;
      // Lean out of the turn rate. Positive roll tips the bike toward -X,
      // which is the rider's right - so a right-hander, which is yaw FALLING,
      // has to come out positive. Getting this backwards is the same sign trap
      // the mirrors and the minimap both fell into.
      const lean = dt > 0 ? Math.max(-0.55, Math.min(0.55, -(applied / dt) * 0.22)) : 0;
      r.model.roll.rotation.z = lean;
      r.phase += dt;
      r.model.pitch.rotation.x =
        -r.loft * t.height + Math.sin(r.phase * 5.1) * t.wobble * r.loft;

      // Wheels. The front keeps turning when it comes up and then winds down,
      // because that is what a lofted wheel does.
      r.spin += (speed / Math.max(0.05, r.spec.look.rearRadius)) * dt;
      r.frontSpin += (speed / Math.max(0.05, r.spec.look.frontRadius)) * dt * (1 - r.loft * 0.75);
      r.model.rear.rotation.x = r.spin;
      r.model.front.rotation.x = r.frontSpin;

      // ---- what the player sees -------------------------------------------
      const range = Math.hypot(r.drawX - px, r.drawZ - pz);
      g.visible = range < DRAW_RADIUS;
      this.report.blips.push({ x: r.drawX, z: r.drawZ });

      // Contact. CONTACT_RANGE is a shade wider than the collision box so
      // brushing past counts - you should not have to actually crash into
      // somebody to get their attention.
      if (range < CONTACT_RANGE) {
        if (this.touching !== i) {
          this.touching = i;
          this.report.contact = {
            index: i, name: r.spec.name, skill: r.spec.skill, wearing: r.spec.wearing,
          };
        }
      } else if (this.touching === i) {
        this.touching = -1;
      }

      r.greeted = Math.max(0, r.greeted - dt);
      if (range < HAIL_RANGE && r.greeted <= 0 && !this.report.hail) {
        r.greeted = HAIL_COOL;
        this.report.hail = {
          name: r.spec.name,
          line: HELLOS[Math.floor(this.rnd() * HELLOS.length)],
          wheelie: r.up ? r.run : 0,
        };
      }
    }
    return this.report;
  }

  /**
   * Decides whether the wheel is up, and blends it.
   *
   * A rider only starts one with room ahead - lofting into a junction they are
   * about to turn at looks like a mistake rather than a choice - and always
   * puts it down before the corner.
   */
  private think(r: Rider, t: TemperTuning, dt: number): void {
    const roomAhead = Math.hypot(r.tx - r.x, r.tz - r.z);
    r.timer -= dt;
    // Racing: a third of the rest and half again on the hold. They are not a
    // different rider, they are the same rider going for it.
    const rest: [number, number] = r.racing
      ? [t.rest[0] * 0.3, t.rest[1] * 0.3] : t.rest;
    const hold: [number, number] = r.racing
      ? [t.hold[0] * 1.5, t.hold[1] * 1.5] : t.hold;

    if (r.up) {
      // Down before the corner, whatever the timer says.
      if (r.timer <= 0 || roomAhead < 22) {
        r.up = false;
        r.timer = this.between(rest);
        if (r.run > r.best) r.best = r.run;
      }
    } else if (r.timer <= 0 && roomAhead > (r.racing ? 45 : 70)) {
      r.up = true;
      r.run = 0;
      r.timer = this.between(hold);
    }

    // Up in about a third of a second, down a little quicker - the same shape
    // as the player's, so a rival reads as somebody doing what you are doing.
    const rate = r.up ? 3.2 : -4.4;
    r.loft = Math.max(0, Math.min(1, r.loft + rate * dt));
  }

  /** True if a bike of radius `r` at (x, z) is on top of a rival. */
  hits(x: number, z: number, radius: number): boolean {
    // Nobody is an obstacle during a battle. You are riding alongside them for
    // a minute; being solid would turn the race into a demolition derby.
    if (this.setting === 'off' || this.battling) return false;
    for (const rider of this.riders) {
      const fx = Math.sin(rider.yaw);
      const fz = Math.cos(rider.yaw);
      const cx = rider.drawX;
      const cz = rider.drawZ;
      // Along the bike it is a metre and a bit; across, barely more than the
      // bars. Treating it as a circle at the wide radius made them feel like
      // bollards; this lets you split past one, which you should be able to.
      const ox = x - cx;
      const oz = z - cz;
      const along = ox * fx + oz * fz;
      const across = -ox * fz + oz * fx;
      if (Math.abs(along) < 1.0 + radius && Math.abs(across) < RIVAL_HALF + radius) return true;
    }
    return false;
  }
}
