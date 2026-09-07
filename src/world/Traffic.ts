import * as THREE from 'three';
import { CAR_COLORS, CAR_HALF, makeCar } from './Props';
import { LAYOUT } from './City';

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
  /** +1 drives toward +Z, -1 toward -Z. */
  dir: number;
  lane: number;
  z: number;
  /** Per-car multiplier so the line doesn't move like a train. */
  pace: number;
}

/** Cars per lane. Eight down a 490 m avenue is a car every ~60 m. */
const PER_LANE = 8;

export class Traffic {
  readonly root = new THREE.Group();

  private cars: Car[] = [];
  private setting: TrafficSpeed = 'regular';

  constructor() {
    // The rider faces +Z and their right hand is -X (see the roll sign note in
    // BikeSim), so driving on the right puts same-direction traffic at -X and
    // oncoming at +X. Parked cars sit at +/-4.95, so the lanes stay inside that.
    const lanes: Array<{ x: number; dir: number }> = [
      { x: -2.3, dir: 1 },
      { x: 2.3, dir: -1 },
    ];
    const span = LAYOUT.avenueEnd - LAYOUT.avenueStart;

    let seed = 20240;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (const lane of lanes) {
      for (let i = 0; i < PER_LANE; i++) {
        const group = makeCar(CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]);
        // A car driving toward -Z is the model turned around; the body's front
        // is +Z (the cabin sits back from it).
        group.rotation.y = lane.dir > 0 ? 0 : Math.PI;
        // Stagger the two lanes so they don't drive in matched pairs.
        const offset = lane.dir > 0 ? 0 : span / (PER_LANE * 2);
        const z = LAYOUT.avenueStart + offset + (i / PER_LANE) * span;
        group.position.set(lane.x, 0, z);
        this.root.add(group);
        this.cars.push({ group, dir: lane.dir, lane: lane.x, z, pace: 0.85 + rnd() * 0.3 });
      }
    }

    this.setSpeed('regular');
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

  update(dt: number): void {
    if (this.setting === 'off') return;
    const base = TRAFFIC_SPEEDS[this.setting];
    const start = LAYOUT.avenueStart;
    const end = LAYOUT.avenueEnd;
    const span = end - start;

    for (const car of this.cars) {
      car.z += car.dir * base * car.pace * dt;
      // Wrap rather than despawn. The avenue is a closed slice, and a car
      // appearing 490 m away is never seen to pop in.
      if (car.z > end) car.z -= span;
      else if (car.z < start) car.z += span;
      car.group.position.z = car.z;
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
      if (Math.abs(x - car.lane) > CAR_HALF.x + r) continue;
      if (Math.abs(z - car.z) > CAR_HALF.z + r) continue;
      return true;
    }
    return false;
  }
}
