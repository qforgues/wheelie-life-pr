import type { GearboxTuning } from './tuning';

/**
 * Manual 5-speed. Shifts are clutchless: torque is cut for a beat, which is
 * exactly what makes the nose drop mid-wheelie. Learning to feed the pull-back
 * through an upshift is the core skill of the game.
 */
export class Gearbox {
  gear = 0;
  /** Seconds remaining in the current torque interruption. */
  shiftTimer = 0;
  /** Set for one step when a shift actually engages, so audio can bark. */
  justEngaged = false;

  constructor(private tuning: GearboxTuning) {}

  setTuning(t: GearboxTuning): void {
    this.tuning = t;
    this.gear = Math.min(this.gear, t.gearRatios.length - 1);
  }

  get topGear(): number {
    return this.tuning.gearRatios.length - 1;
  }

  get shifting(): boolean {
    return this.shiftTimer > 0;
  }

  /** Total crank -> wheel reduction for the current gear. */
  get totalRatio(): number {
    const t = this.tuning;
    return t.primaryRatio * t.gearRatios[this.gear] * t.finalRatio;
  }

  ratioFor(gear: number): number {
    const t = this.tuning;
    return t.primaryRatio * t.gearRatios[gear] * t.finalRatio;
  }

  requestUp(): boolean {
    if (this.shifting || this.gear >= this.topGear) return false;
    this.gear++;
    this.shiftTimer = this.tuning.shiftTimeUp;
    return true;
  }

  requestDown(): boolean {
    if (this.shifting || this.gear <= 0) return false;
    this.gear--;
    this.shiftTimer = this.tuning.shiftTimeDown;
    return true;
  }

  update(dt: number): void {
    this.justEngaged = false;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.shiftTimer = 0;
        this.justEngaged = true;
      }
    }
  }

  /**
   * How much of the engine's torque reaches the wheel right now, 0..1.
   * Ramps back in rather than snapping, so the drivetrain doesn't shock-load.
   */
  couplingFactor(): number {
    if (!this.shifting) return 1;
    const total = this.tuning.shiftTimeUp;
    const remaining = this.shiftTimer / Math.max(total, 1e-4);
    // Fully cut for the first half, then ramps back in.
    return remaining > 0.5 ? 0 : 1 - remaining * 2;
  }

  reset(): void {
    this.gear = 0;
    this.shiftTimer = 0;
    this.justEngaged = false;
  }
}
