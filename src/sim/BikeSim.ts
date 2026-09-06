import { Engine, clamp, damp, lerp } from './Engine';
import { Gearbox } from './Gearbox';
import { TRICKS, type BikeTuning } from './tuning';
import type { BikeState, CrashReason, GroundProvider, RiderInput } from './types';

const G = 9.81;
const RPM_PER_RADS = 60 / (2 * Math.PI);

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
  /** Optional rolling start (m/s). A crash reset that dumps you at a standstill
   *  turns every attempt into a 6-second run-up, which kills the practice loop. */
  speed?: number;
  /** Gear index to drop back in with. */
  gear?: number;
}

/**
 * The bike.
 *
 * Rendering-free on purpose: this file knows about metres, newtons and seconds
 * and nothing else. Everything downstream (meshes, camera, audio, HUD, haptics)
 * reads `state` and never writes to it.
 *
 * The pitch axis is modelled as a rigid body rotating about the REAR CONTACT
 * PATCH, which is the correct pivot for a wheelie and is what gives the balance
 * point its natural, unstable feel:
 *
 *   I_rear * pitchAccel =  m * a * h'      (inertial reaction - throttle lifts you)
 *                        - m * g * d'      (gravity - pulls you back down...
 *                                           ...until d' goes negative past the
 *                                           balance point, then it throws you over)
 *                        + riderYank
 *                        - damping * pitchRate
 *
 * where (d', h') is the CG offset from the rear contact patch, rotated by pitch.
 * d' hits zero at pitch = atan(d / h). That angle IS the balance point, it moves
 * when the rider shifts their weight, and it is never drawn on screen.
 */
export class BikeSim {
  readonly state: BikeState;
  readonly engine: Engine;
  readonly gearbox: Gearbox;

  private tuning: BikeTuning;
  private ground: GroundProvider;
  private spawn: SpawnPoint;

  /** Rider weight shifted rearward from neutral (m). */
  private weightShift = 0;
  /** Low-frequency wander that makes the roll axis feel alive. */
  private rollNoise = 0;
  private rollNoiseTarget = 0;
  private rollNoiseTimer = 0;
  private rollRate = 0;
  private resetTimer = 0;
  /** Pitch imposed by the terrain under the two wheels, last step. */
  private prevPitchFloor = 0;

  constructor(tuning: BikeTuning, ground: GroundProvider, spawn: SpawnPoint) {
    this.tuning = tuning;
    this.ground = ground;
    this.spawn = spawn;
    this.engine = new Engine(tuning.engine);
    this.gearbox = new Gearbox(tuning.gearbox);
    this.state = {
      mode: 'riding',
      x: spawn.x,
      y: 0,
      z: spawn.z,
      yaw: spawn.yaw,
      pitch: 0,
      roll: 0,
      speed: 0,
      accel: 0,
      pitchRate: 0,
      yawRate: 0,
      rpm: tuning.engine.idleRpm,
      gear: 0,
      shifting: false,
      wheelSlip: 0,
      onLimiter: false,
      wheelieing: false,
      scraping: false,
      balanceError: 0,
      balancePoint: Math.atan(tuning.chassis.cgToRear / tuning.chassis.cgHeight),
      lastImpact: 0,
      crashReason: null,
      trick: 'none',
      trickBlend: 0,
    };
  }

  /** Hot-swap tuning from the debug panel without restarting the run. */
  setTuning(t: BikeTuning): void {
    this.tuning = t;
    this.engine.setTuning(t.engine);
    this.gearbox.setTuning(t.gearbox);
  }

  getTuning(): BikeTuning {
    return this.tuning;
  }

  setSpawn(p: SpawnPoint): void {
    this.spawn = p;
  }

  reset(at?: SpawnPoint): void {
    const s = this.state;
    const p = at ?? this.spawn;
    s.mode = 'riding';
    s.x = p.x;
    s.z = p.z;
    s.y = 0;
    s.yaw = p.yaw;
    s.pitch = 0;
    s.roll = 0;
    s.speed = p.speed ?? 0;
    s.accel = 0;
    s.pitchRate = 0;
    s.yawRate = 0;
    s.gear = Math.min(p.gear ?? 0, this.tuning.gearbox.gearRatios.length - 1);
    this.gearbox.reset();
    this.gearbox.gear = s.gear;
    s.rpm = Math.max(
      this.tuning.engine.idleRpm,
      (s.speed / this.tuning.chassis.wheelRadius) * this.gearbox.totalRatio * RPM_PER_RADS,
    );
    s.shifting = false;
    s.wheelSlip = 0;
    s.onLimiter = false;
    s.wheelieing = false;
    s.scraping = false;
    s.balanceError = 0;
    s.lastImpact = 0;
    s.crashReason = null;
    s.trick = 'none';
    s.trickBlend = 0;
    this.weightShift = 0;
    this.rollRate = 0;
    this.rollNoise = 0;
    this.resetTimer = 0;
    this.prevPitchFloor = this.groundPitch(s.x, s.z, s.yaw);
    s.pitch = this.prevPitchFloor;
    s.y = this.ground.heightAt(s.x, s.z, this.tuning.chassis.wheelRadius);
  }

  crash(reason: CrashReason, impact = 0): void {
    if (this.state.mode !== 'riding') return;
    this.state.mode = 'crashed';
    this.state.crashReason = reason;
    this.state.lastImpact = impact;
    this.resetTimer = 0;
  }

  /** Pitch the terrain forces on the bike at a given pose (rad). */
  private groundPitch(x: number, z: number, yaw: number): number {
    const { wheelbase, wheelRadius } = this.tuning.chassis;
    const rear = this.ground.heightAt(x, z, wheelRadius);
    const front = this.ground.heightAt(
      x + Math.sin(yaw) * wheelbase, z + Math.cos(yaw) * wheelbase, wheelRadius,
    );
    return Math.atan2(front - rear, wheelbase);
  }

  /** Seconds since the crash started, for the wipeout animation. */
  get crashTime(): number {
    return this.resetTimer;
  }

  step(input: RiderInput, dt: number): void {
    if (this.state.mode !== 'riding') {
      this.stepCrashed(dt);
      return;
    }
    this.stepRiding(input, dt);
  }

  // ---------------------------------------------------------------- crashed

  private stepCrashed(dt: number): void {
    const s = this.state;
    this.resetTimer += dt;
    // Slide to a stop and flop over. Purely cosmetic; the sim is parked.
    s.speed = damp(s.speed, 0, 3.2, dt);
    s.x += Math.sin(s.yaw) * s.speed * dt;
    s.z += Math.cos(s.yaw) * s.speed * dt;
    s.roll = damp(s.roll, Math.sign(s.roll || 1) * 1.35, 6, dt);
    s.pitch = damp(s.pitch, 0, 5, dt);
    s.rpm = damp(s.rpm, this.tuning.engine.idleRpm, 2.5, dt);
    s.wheelieing = false;
    s.scraping = false;
    s.wheelSlip = 0;
  }

  // ----------------------------------------------------------------- riding

  private stepRiding(input: RiderInput, dt: number): void {
    const s = this.state;
    const { chassis: ch, rider, brakes, tyre, aero, limits, steering, balance } = this.tuning;

    // --- rider weight shift ------------------------------------------------
    // The body can only move so fast; the *rate* of that movement is the yank
    // that snaps the front wheel up. Holding back just keeps the CG rearward.
    const shiftTarget = clamp(input.weight, -0.35, 1) * rider.weightShiftRange;
    const prevShift = this.weightShift;
    const maxStep = rider.weightShiftRate * dt;
    this.weightShift = clamp(
      this.weightShift + clamp(shiftTarget - this.weightShift, -maxStep, maxStep),
      -rider.weightShiftRange * 0.35,
      rider.weightShiftRange,
    );
    const shiftRate = dt > 0 ? (this.weightShift - prevShift) / dt : 0;

    // --- tricks ------------------------------------------------------------
    // A trick only holds while the front wheel is genuinely up; put it down and
    // the rider gets back in the seat whether they let go of the button or not.
    const clearanceNowForTrick = s.pitch - this.prevPitchFloor;
    // Tolerate an input that predates tricks rather than throwing: this struct
    // is the boundary other layers feed, and a missing field should degrade to
    // "no trick", not take the whole sim down.
    const wanted = TRICKS[input.trick] ? input.trick : 'none';
    const canHold =
      wanted !== 'none' && clearanceNowForTrick > TRICKS[wanted].minPitch && s.mode === 'riding';
    if (canHold) {
      s.trick = wanted;
    } else if (s.trick !== 'none') {
      // Keep blending out of the trick we were in rather than snapping.
      if (wanted !== s.trick || clearanceNowForTrick < TRICKS[s.trick].minPitch * 0.6) {
        s.trickBlend = damp(s.trickBlend, 0, TRICKS[s.trick].blendRate, dt);
        if (s.trickBlend < 0.01) { s.trickBlend = 0; s.trick = 'none'; }
      }
    }
    if (s.trick !== 'none' && canHold) {
      s.trickBlend = damp(s.trickBlend, 1, TRICKS[s.trick].blendRate, dt);
    }
    const trick = TRICKS[s.trick];

    // CG relative to the rear contact patch, at zero pitch.
    // Standing up raises the CG, which lowers the balance point and makes the
    // bike both easier to lift and easier to loop. That trade is the trick.
    const dCg = ch.cgToRear - this.weightShift + trick.cgToRear * s.trickBlend;
    const hCg = ch.cgHeight + trick.cgHeight * s.trickBlend;

    s.balancePoint = Math.atan2(dCg, hCg);

    // --- gearbox -----------------------------------------------------------
    if (input.shiftUp) this.gearbox.requestUp();
    if (input.shiftDown) this.gearbox.requestDown();
    this.gearbox.update(dt);
    s.gear = this.gearbox.gear;
    s.shifting = this.gearbox.shifting;

    // --- driveline ---------------------------------------------------------
    const ratio = this.gearbox.totalRatio;
    const wheelOmega = s.speed / ch.wheelRadius;
    const lockedRpm = wheelOmega * ratio * RPM_PER_RADS;

    // Auto-clutch: below walking pace the clutch slips so you can pull away and
    // so a hard landing doesn't stall it.
    const lock = smoothstep(0, this.tuning.gearbox.clutchSlipSpeed, s.speed);
    const slipRpm = this.tuning.engine.idleRpm + input.throttle * 4200;
    const targetRpm = lerp(Math.max(slipRpm, lockedRpm), lockedRpm, lock);

    if (this.gearbox.shifting) {
      // Clutchless shift: the crank is disconnected, so it just spins down.
      s.rpm = damp(s.rpm, this.tuning.engine.idleRpm + input.throttle * 2500, 5.5, dt);
    } else {
      // Flywheel inertia makes the revs lag the wheels very slightly.
      s.rpm = damp(s.rpm, targetRpm, 24 / Math.max(this.tuning.engine.flywheelInertia, 0.01) * 0.02 + 18, dt);
    }
    s.rpm = clamp(s.rpm, 0, this.tuning.engine.limiterRpm + 200);
    s.onLimiter = this.engine.onLimiter(s.rpm);

    const limiterCut = s.onLimiter ? (Math.sin(performance.now() * 0.09) > 0 ? 0 : 1) : 1;
    const crankTorque = this.engine.torqueAt(s.rpm, input.throttle) * limiterCut;
    const wheelTorque =
      crankTorque * ratio * this.tuning.gearbox.efficiency * this.gearbox.couplingFactor();

    let driveForce = wheelTorque / ch.wheelRadius;

    // --- ground ------------------------------------------------------------
    // Height under each wheel separately. The difference between them IS the
    // pitch the terrain is forcing on the bike, which is where bump lofts come
    // from - no scripted impulse, just a ramp that's physically in the way.
    const rearHeight = this.ground.heightAt(s.x, s.z, ch.wheelRadius);
    const frontHeight = this.ground.heightAt(
      s.x + Math.sin(s.yaw) * ch.wheelbase,
      s.z + Math.cos(s.yaw) * ch.wheelbase,
      ch.wheelRadius,
    );
    s.y = rearHeight;
    const pitchFloor = Math.atan2(frontHeight - rearHeight, ch.wheelbase);
    const floorRate = dt > 0 ? (pitchFloor - this.prevPitchFloor) / dt : 0;
    this.prevPitchFloor = pitchFloor;
    const friction = this.ground.frictionAt(s.x, s.z);

    // How far the front wheel is off the road, measured from the road - not
    // from horizontal, so cresting a bump doesn't read as a wheelie.
    const clearance = s.pitch - pitchFloor;

    // --- normal loads ------------------------------------------------------
    // Once the front is off the ground the rear carries everything, which is
    // why a wheelie hooks up so well. Blended over the first couple of degrees
    // so grip doesn't double in a single step as the wheel leaves the tarmac.
    const wheelieUp = clearance > 1e-3;
    const liftBlend = smoothstep(0, 0.045, clearance);
    const staticRear = (ch.wheelbase - dCg) / ch.wheelbase;
    const transfer = (s.accel * hCg) / (ch.wheelbase * G);
    const rearLoadFrac = lerp(clamp(staticRear + transfer, 0.15, 1), 1, liftBlend);
    const rearNormal = ch.mass * G * rearLoadFrac;
    const frontNormal = ch.mass * G - rearNormal;

    // --- traction limit ----------------------------------------------------
    const gripLong = tyre.gripLong * friction;
    const maxDrive = gripLong * rearNormal;
    let slip = 0;
    if (driveForce > maxDrive) {
      slip = clamp((driveForce - maxDrive) / Math.max(maxDrive, 1), 0, 1.5);
      driveForce = maxDrive;
    } else if (driveForce < -maxDrive) {
      driveForce = -maxDrive;
    }
    s.wheelSlip = damp(s.wheelSlip, slip, 12, dt);

    // --- brakes ------------------------------------------------------------
    // One lever. While both wheels are down it's split front/rear; the moment
    // the front leaves the ground the whole lot goes to the rear, which is
    // exactly what lets a stab of brake save a wheelie that's going over.
    const rearShare = wheelieUp ? 1 : brakes.rearBiasGrounded;
    const frontShare = wheelieUp ? 0 : 1 - brakes.rearBiasGrounded;
    const rearBrakeForce = Math.min(
      (input.brake * rearShare * brakes.rearMaxTorque) / ch.wheelRadius,
      gripLong * rearNormal,
    );
    const frontBrakeForce = Math.min(
      (input.brake * frontShare * brakes.frontMaxTorque) / ch.wheelRadius,
      gripLong * frontNormal,
    );
    const brakeForce = s.speed > 0.05 ? rearBrakeForce + frontBrakeForce : 0;

    // --- the tail dragging -------------------------------------------------
    // Past the scrape angle the back of the bike is on the road. It pushes the
    // nose back down and scrubs speed off, which is what turns the last twenty
    // degrees from a cliff edge into a save you can actually make.
    const scrapeSpan = Math.max(0.05, limits.crashPitch - limits.scrapePitch);
    const scrapeAmount = clamp((s.pitch - limits.scrapePitch) / scrapeSpan, 0, 1);
    const scrapeForce = scrapeAmount * limits.scrapeDrag;

    // --- resistance --------------------------------------------------------
    const dragForce = aero.dragK * s.speed * Math.abs(s.speed);
    const rollForce = Math.sign(s.speed) * aero.rollingResistance * ch.mass * G;

    // --- longitudinal ------------------------------------------------------
    const netForce = driveForce - brakeForce - dragForce - rollForce - scrapeForce;
    let accel = netForce / ch.mass;
    if (s.speed <= 0 && accel < 0) accel = 0; // no reverse
    s.accel = accel;
    s.speed = Math.max(0, s.speed + accel * dt);

    // --- pitch (the whole game) -------------------------------------------
    const cosP = Math.cos(s.pitch);
    const sinP = Math.sin(s.pitch);
    // CG offset from the rear contact patch, rotated into the pitched frame.
    const dPrime = dCg * cosP - hCg * sinP; // forward of the contact patch
    const hPrime = dCg * sinP + hCg * cosP; // above the contact patch

    const inertiaRear = ch.pitchInertia + ch.mass * (dCg * dCg + hCg * hCg);

    const tauGravity = -ch.mass * G * dPrime;
    const tauAccel = ch.mass * accel * hPrime;
    const tauYank = rider.yankGain * shiftRate;

    // The front tyre and forks push back hard against the last few degrees, so
    // the bike sits on its wheels instead of jittering around pitch = 0.
    const grounded = clearance < 1e-4 && s.pitchRate <= 0;
    const dampCoef = grounded ? ch.groundedPitchDamping : ch.pitchDamping;
    const tauDamp = -dampCoef * s.pitchRate;
    const tauScrape = -scrapeAmount * limits.scrapeRestoreTorque;

    const pitchAccel =
      (tauGravity + tauAccel + tauYank + tauDamp + tauScrape) / inertiaRear;
    s.pitchRate += pitchAccel * dt;
    s.pitch += s.pitchRate * dt;

    if (s.pitch <= pitchFloor) {
      // Front wheel is on the road (or being pushed up by it).
      if (s.pitchRate < -0.35) {
        s.pitchRate = -s.pitchRate * ch.frontSlamRestitution;
        s.speed *= 1 - clamp(Math.abs(s.pitchRate) * 0.02, 0, 0.08);
      } else {
        s.pitchRate = 0;
      }
      s.pitch = pitchFloor;
      // Riding up the face of a bump throws the nose, and the faster you hit
      // it the harder it throws, because floorRate scales with speed - the free
      // lift falls out of the geometry. What the forks would have absorbed is
      // taken back out, and the whole thing is capped so no piece of terrain
      // can ever launch the bike outright.
      if (floorRate > 0) {
        const kick = Math.min(floorRate * (1 - ch.bumpAbsorption), ch.maxBumpKick);
        s.pitchRate = Math.max(s.pitchRate, kick);
      }
    }

    const clearanceNow = s.pitch - pitchFloor;
    s.wheelieing = clearanceNow > limits.wheelieCountPitch;
    s.scraping = s.pitch > limits.scrapePitch;
    s.balanceError = s.pitch - s.balancePoint;

    // --- steering ----------------------------------------------------------
    const wheelieFactor = smoothstep(limits.wheelieCountPitch, 0.5, clearanceNow);
    const steerAuth = lerp(1, steering.wheelieSteerScale, wheelieFactor);
    const speedFactor = 1 / (1 + s.speed / steering.yawSpeedFalloff);
    const targetYaw = -input.steer * steering.maxYawRateLow * speedFactor * steerAuth
      * smoothstep(0, 1.2, s.speed);
    s.yawRate = damp(s.yawRate, targetYaw, steering.yawResponse, dt);
    s.yaw += s.yawRate * dt;

    // --- roll: the unwritten balance axis ----------------------------------
    // Only unstable while the front wheel is up. There is no meter for this on
    // purpose - you read it off the horizon, the engine note and the rumble.
    this.updateRoll(input, wheelieFactor, balance.rollInstability, dt);

    // --- integrate position ------------------------------------------------
    s.x += Math.sin(s.yaw) * s.speed * dt;
    s.z += Math.cos(s.yaw) * s.speed * dt;

    // --- failure modes -----------------------------------------------------
    if (s.pitch > limits.crashPitch) {
      this.crash('looped', s.speed);
      return;
    }
    if (Math.abs(s.roll) > balance.rollCrashAngle) {
      this.crash('lowside', s.speed);
      return;
    }
    const hit = this.ground.collide(s.x, s.z, s.speed);
    if (hit) {
      if (s.speed > limits.crashImpactSpeed) {
        this.crash(hit, s.speed);
      } else {
        // Low-speed nudge: just stop, don't punish.
        s.speed = 0;
        s.x -= Math.sin(s.yaw) * 0.25;
        s.z -= Math.cos(s.yaw) * 0.25;
      }
    }
  }

  private updateRoll(
    input: RiderInput,
    wheelieFactor: number,
    instability: number,
    dt: number,
  ): void {
    const s = this.state;
    const b = this.tuning.balance;

    // Slow random wander so no two wheelies fall the same way.
    this.rollNoiseTimer -= dt;
    if (this.rollNoiseTimer <= 0) {
      this.rollNoiseTimer = 0.45 + Math.random() * 0.7;
      this.rollNoiseTarget = (Math.random() * 2 - 1) * 0.9;
    }
    this.rollNoise = damp(this.rollNoise, this.rollNoiseTarget, 2.2, dt);

    if (wheelieFactor > 0.01) {
      // Side-to-side while the front is up.
      //
      // Sign matters and is easy to get backwards: the bike faces +Z, so the
      // rider's right is -X, and a positive Z-rotation tips the bike that way.
      // Positive roll is therefore "leaning right", and stick-right must push
      // roll positive.
      //
      // The bike is a genuine inverted pendulum up here (`diverge`), but it
      // also wants to stand itself back up (`restore`). Which of those wins
      // decides whether this reads as leaning or as falling - see
      // BalanceTuning.rollResponse. Default has restore winning, so a lean
      // settles at an angle and holds instead of running away to the deck.
      const control = input.steer * b.rollAuthority;
      const diverge = instability * b.rollDivergence * Math.sin(s.roll);
      const restore = -b.rollResponse * s.roll;
      const wander = instability * 0.35 * this.rollNoise;
      this.rollRate += (control + (diverge + wander) * wheelieFactor + restore) * dt;
      this.rollRate -= this.rollRate * b.rollDamping * dt;
      s.roll += this.rollRate * dt;
    } else {
      // Wheels down: the bike leans into the turn and stands itself back up.
      s.roll = damp(s.roll, input.steer * 0.22 * smoothstep(2, 12, s.speed), 6, dt);
      this.rollRate = damp(this.rollRate, 0, 8, dt);
    }
  }

  // ------------------------------------------------------------- readouts

  get weightShiftValue(): number {
    return this.weightShift;
  }

  /** Rear wheel angular speed (rad/s) - drives wheel spin and tyre audio. */
  get wheelSpin(): number {
    const base = this.state.speed / this.tuning.chassis.wheelRadius;
    return base * (1 + this.state.wheelSlip * 1.6);
  }
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}
