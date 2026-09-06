import type { BikeState } from '../sim/types';

export interface WheelieRun {
  distance: number;
  duration: number;
  topSpeed: number;
  topGear: number;
}

const EMPTY: WheelieRun = { distance: 0, duration: 0, topSpeed: 0, topGear: 0 };

/**
 * Measures a wheelie. Distance is the only number that really matters in the
 * prototype - it's the thing you chase, and it's the thing the whole physics
 * model is in service of.
 *
 * A run ends when the front wheel touches down, not when you crash, so looping
 * it out still banks whatever you'd already ridden.
 */
export class WheelieTracker {
  current: WheelieRun = { ...EMPTY };
  last: WheelieRun = { ...EMPTY };
  best: WheelieRun = { ...EMPTY };
  active = false;
  /** Set for one frame when a run ends having beaten the record. */
  justSetRecord = false;
  /** Set for one frame when a run ends at all. */
  justEnded = false;

  private lastX = 0;
  private lastZ = 0;
  private hasPrev = false;

  update(state: BikeState, dt: number): void {
    this.justSetRecord = false;
    this.justEnded = false;

    const riding = state.mode === 'riding';
    const up = riding && state.wheelieing;

    if (up) {
      if (!this.active) {
        this.active = true;
        this.current = { ...EMPTY };
        this.hasPrev = false;
      }
      if (this.hasPrev) {
        const dx = state.x - this.lastX;
        const dz = state.z - this.lastZ;
        this.current.distance += Math.hypot(dx, dz);
      }
      this.current.duration += dt;
      this.current.topSpeed = Math.max(this.current.topSpeed, state.speed);
      this.current.topGear = Math.max(this.current.topGear, state.gear);
      this.lastX = state.x;
      this.lastZ = state.z;
      this.hasPrev = true;
    } else if (this.active) {
      this.endRun();
    }
  }

  /** Called when the bike crashes or the player resets mid-wheelie. */
  endRun(): void {
    if (!this.active) return;
    this.active = false;
    this.justEnded = true;
    this.last = { ...this.current };
    if (this.current.distance > this.best.distance) {
      this.best = { ...this.current };
      this.justSetRecord = true;
    }
    this.current = { ...EMPTY };
    this.hasPrev = false;
  }

  resetSession(): void {
    this.current = { ...EMPTY };
    this.last = { ...EMPTY };
    this.best = { ...EMPTY };
    this.active = false;
    this.hasPrev = false;
  }
}
