import type { BikeState } from '../sim/types';

export interface WheelieRun {
  distance: number;
  /** Distance with trick multipliers applied - what actually counts. */
  score: number;
  duration: number;
  topSpeed: number;
  topGear: number;
}

const EMPTY: WheelieRun = { distance: 0, score: 0, duration: 0, topSpeed: 0, topGear: 0 };

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
  /** Whether the last run counted. A run you fell out of does not. */
  lastBanked = true;

  private lastX = 0;
  private lastZ = 0;
  private hasPrev = false;

  update(state: BikeState, dt: number, multiplier = 1): void {
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
        const step = Math.hypot(dx, dz);
        this.current.distance += step;
        this.current.score += step * multiplier;
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

  /**
   * Ends the current run. `banked` is false when the rider fell out of it -
   * you still see the distance, but it doesn't go in the record book. Landing
   * it is part of the trick.
   */
  endRun(banked = true): void {
    if (!this.active) return;
    this.active = false;
    this.justEnded = true;
    this.last = { ...this.current };
    this.lastBanked = banked;
    if (banked && this.current.score > this.best.score) {
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
    this.lastBanked = true;
  }
}
