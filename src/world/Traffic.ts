import * as THREE from 'three';
import { CAR_COLORS, CAR_HALF, makeATV, makeCar, makeScooter } from './Props';
import { LAYOUT, MAP } from './City';

/**
 * Cars driving up and down the avenue.
 *
 * Justin asked for traffic to avoid with a toggle, so speed is a setting rather
 * than a constant - and "off" is a first-class option, because learning to hold
 * a wheelie is hard enough without a Corolla in the way.
 *
 * The model is deliberately dumb: each car holds a lane and a constant speed and
 * wraps around when it runs off the end. No lane changes, no braking, no
 * following distance. Traffic that behaves unpredictably would make crashes feel
 * unfair, and the player needs to be able to read a gap and commit to it.
 */

export type TrafficSpeed = 'off' | 'slow' | 'regular' | 'fast';

/** Metres per second. Regular is about 25 mph, which is a real city street. */
export const TRAFFIC_SPEEDS: Record<TrafficSpeed, number> = {
  off: 0,
  slow: 6,
  regular: 11,
  fast: 17,
};

export const TRAFFIC_LABELS: Record<TrafficSpeed, string> = {
  off: 'OFF',
  slow: 'SLOW',
  regular: 'REGULAR',
  fast: 'FAST',
};

export const TRAFFIC_ORDER: TrafficSpeed[] = ['off', 'slow', 'regular', 'fast'];

export function isTrafficSpeed(v: unknown): v is TrafficSpeed {
  return typeof v === 'string' && (TRAFFIC_ORDER as string[]).includes(v);
}

interface Car {
  group: THREE.Group;
  /** Unit direction of travel; one of these is always zero. */
  dx: number;
  dz: number;
  /** Position along the road, and the fixed cross-road coordinate. */
  along: number;
  across: number;
  /** True when the car drives along Z (on an avenue). */
  onAvenue: boolean;
  from: number;
  to: number;
  /** Per-car multiplier so the line doesn't move like a train. */
  pace: number;
}

/**
 * Cars per lane. There are twenty lanes now, so this is per road, not per city:
 * two each still fills the street you are on without putting eighty cars in the
 * scene. Anything past DRAW_RADIUS is switched off outright - traffic you
 * cannot see is not worth a draw call.
 */
const PER_LANE = 2;
const DRAW_RADIUS = 220;
/** Shares of traffic that are not cars. */
const ATV_SHARE = 0.10;
const SCOOTER_SHARE = 0.10;
/** How far either side of the centreline a lane sits. */
const LANE = 2.3;

export class Traffic {
  readonly root = new THREE.Group();

  private cars: Car[] = [];
  private setting: TrafficSpeed = 'regular';

  constructor() {
    let seed = 20240;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // The rider faces +Z and their right hand is -X (see the roll sign note in
    // BikeSim), so driving on the right puts traffic heading +Z on the -X side
    // of the centreline, and the mirror of that on the cross streets.
    for (const ax of LAYOUT.avenueX) {
      for (const dir of [1, -1]) {
        this.lane(true, ax - dir * LANE, dir, MAP.zMin, MAP.zMax, rnd);
      }
    }
    for (const sz of LAYOUT.streetZ) {
      for (const dir of [1, -1]) {
        this.lane(false, sz + dir * LANE, dir, MAP.xMin, MAP.xMax, rnd);
      }
    }

    this.setSpeed('regular');
  }

  private lane(
    onAvenue: boolean, across: number, dir: number,
    from: number, to: number, rnd: () => number,
  ): void {
    const span = to - from;
    for (let i = 0; i < PER_LANE; i++) {
      // A tenth of the traffic is somebody on a four-track. They obey the same
      // lane and the same collision box - it just looks like a different
      // Sunday, which is what a street here actually looks like.
      const colour = CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)];
      // A tenth on cuatrimotos and a tenth on chumas. Both obey the same lane
      // and the same collision box; only the silhouette changes.
      const roll = rnd();
      const group = roll < ATV_SHARE
        ? makeATV(colour)
        : roll < ATV_SHARE + SCOOTER_SHARE
          ? makeScooter(colour)
          : makeCar(colour);
      // The body's front is +Z, so an avenue car heading -Z is turned around
      // and a street car is a quarter turn from either.
      group.rotation.y = onAvenue
        ? (dir > 0 ? 0 : Math.PI)
        : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const along = from + ((i + rnd() * 0.6) / PER_LANE) * span;
      const car: Car = {
        group,
        dx: onAvenue ? 0 : dir,
        dz: onAvenue ? dir : 0,
        along, across, onAvenue, from, to,
        pace: 0.85 + rnd() * 0.3,
      };
      this.place(car);
      this.root.add(group);
      this.cars.push(car);
    }
  }

  private place(car: Car): void {
    if (car.onAvenue) car.group.position.set(car.across, 0, car.along);
    else car.group.position.set(car.along, 0, car.across);
  }

  get speed(): TrafficSpeed {
    return this.setting;
  }

  setSpeed(s: TrafficSpeed): void {
    this.setting = s;
    // Off means gone, not parked in the road: stationary cars in both lanes
    // would be a worse obstacle course than moving ones.
    this.root.visible = s !== 'off';
  }

  update(dt: number, px = 0, pz = 0): void {
    if (this.setting === 'off') return;
    const base = TRAFFIC_SPEEDS[this.setting];
    const r2 = DRAW_RADIUS * DRAW_RADIUS;

    for (const car of this.cars) {
      const dir = car.onAvenue ? car.dz : car.dx;
      car.along += dir * base * car.pace * dt;
      // Wrap rather than despawn. Each road is a closed loop as far as traffic
      // is concerned, and a car reappearing 500 m away is never seen to pop in.
      const span = car.to - car.from;
      if (car.along > car.to) car.along -= span;
      else if (car.along < car.from) car.along += span;
      this.place(car);

      // Keep simulating it - it still has to be in the right place when it
      // comes back into range - but stop drawing it.
      const dx = car.group.position.x - px;
      const dz2 = car.group.position.z - pz;
      car.group.visible = dx * dx + dz2 * dz2 < r2;
    }
  }

  /**
   * True if a bike of radius `r` at (x, z) is inside a car.
   *
   * Cars are axis-aligned in their lane, so this stays a box test - no rotation
   * to worry about, which keeps it cheap enough to run every physics step.
   */
  hits(x: number, z: number, r: number): boolean {
    if (this.setting === 'off') return false;
    for (const car of this.cars) {
      // Cars are axis-aligned in their lane, so the box just swaps its sides
      // depending on which way the road runs.
      const halfX = car.onAvenue ? CAR_HALF.x : CAR_HALF.z;
      const halfZ = car.onAvenue ? CAR_HALF.z : CAR_HALF.x;
      const cx = car.onAvenue ? car.across : car.along;
      const cz = car.onAvenue ? car.along : car.across;
      if (Math.abs(x - cx) > halfX + r) continue;
      if (Math.abs(z - cz) > halfZ + r) continue;
      return true;
    }
    return false;
  }
}
