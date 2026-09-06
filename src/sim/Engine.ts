import type { EngineTuning } from './tuning';

/**
 * Single-cylinder torque curve. Two half-cosine lobes joined at the peak so the
 * curve is continuous, has a fat midrange and signs off after the redline.
 */
export class Engine {
  rpm: number;

  constructor(private tuning: EngineTuning) {
    this.rpm = tuning.idleRpm;
  }

  setTuning(t: EngineTuning): void {
    this.tuning = t;
  }

  /** Crank torque (N*m) available at a given rpm and throttle opening. */
  torqueAt(rpm: number, throttle: number): number {
    const t = this.tuning;
    const wot = this.wotTorque(rpm);

    // Closed throttle: pumping losses drag the crank down, scaled by rpm.
    const brake = -t.engineBrakeTorque * clamp(rpm / t.redlineRpm, 0, 1.2);

    // Idle circuit keeps the motor alive when you're off the gas.
    const idleAssist = rpm < t.idleRpm ? (1 - rpm / t.idleRpm) * t.peakTorque * 0.35 : 0;

    return lerp(brake, wot, clamp(throttle, 0, 1)) + idleAssist;
  }

  /** Wide-open-throttle torque, before limiter. */
  wotTorque(rpm: number): number {
    const t = this.tuning;
    if (rpm <= 0) return t.peakTorque * t.lowEndFullness;

    if (rpm < t.peakTorqueRpm) {
      // Rising side: starts at `lowEndFullness` of peak at 0 rpm.
      const u = rpm / t.peakTorqueRpm;
      const shape = 1 - Math.cos(u * Math.PI * 0.5);
      return t.peakTorque * (t.lowEndFullness + (1 - t.lowEndFullness) * shape);
    }

    // Falling side: holds up to the redline, then falls off a cliff.
    const span = Math.max(1, t.limiterRpm - t.peakTorqueRpm);
    const u = clamp((rpm - t.peakTorqueRpm) / span, 0, 1);
    const shape = Math.cos(u * Math.PI * 0.5);
    const past = rpm > t.redlineRpm ? 0.6 : 1;
    return t.peakTorque * (t.topEndFullness + (1 - t.topEndFullness) * shape) * past;
  }

  /** True while the limiter should be cutting spark. */
  onLimiter(rpm: number): boolean {
    return rpm >= this.tuning.limiterRpm;
  }

  /** Peak power, in kW, for the debug readout. */
  peakPowerKw(): number {
    let best = 0;
    for (let rpm = 1000; rpm <= this.tuning.limiterRpm; rpm += 100) {
      best = Math.max(best, (this.wotTorque(rpm) * rpm * Math.PI * 2) / 60 / 1000);
    }
    return best;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}
