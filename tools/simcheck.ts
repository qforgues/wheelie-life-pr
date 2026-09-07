/**
 * Headless physics harness.
 *
 * Runs sim/ with no browser, no Three.js, no DOM - which is both how we check
 * the bike numbers and the standing proof that the sim layer is portable to a
 * console engine later. If this file ever fails to bundle, something rendering-
 * related has leaked into sim/.
 *
 *   npm run sim
 */
import { BikeSim } from '../src/sim/BikeSim';
import { BIKES, cloneTuning, type BikeId } from '../src/sim/tuning';
import type { GroundProvider, RiderInput } from '../src/sim/types';

const DT = 1 / 120;
const RAD = 180 / Math.PI;
const MPH = 2.23694;

const BIKE = ((process.argv[2] ?? 'yz250f') as BikeId);
if (!BIKES[BIKE]) {
  console.error(`unknown bike "${BIKE}". try: ${Object.keys(BIKES).join(', ')}`);
  process.exit(1);
}
const SPEC = BIKES[BIKE];

const flat: GroundProvider = {
  heightAt: () => 0,
  frictionAt: () => 1,
  collide: () => null,
};

/** Flat road with one speed bump on it, for the bump-loft test. */
function withBump(z0: number, half = 0.62, height = 0.115): GroundProvider {
  const raw = (z: number) => {
    const t = (z - z0) / half;
    if (t <= -1 || t >= 1) return 0;
    const c = Math.cos((t * Math.PI) / 2);
    return height * c * c;
  };
  return {
    heightAt: (_x, z, r) => {
      let best = raw(z);
      for (let i = 1; i <= 6; i++) {
        const d = (i / 6) * r;
        const lift = Math.sqrt(Math.max(0, r * r - d * d)) - r;
        best = Math.max(best, raw(z - d) + lift, raw(z + d) + lift);
      }
      return best;
    },
    frictionAt: () => 1,
    collide: () => null,
  };
}

function input(p: Partial<RiderInput> = {}): RiderInput {
  return {
    throttle: 0, brake: 0, steer: 0, weight: 0,
    shiftUp: false, shiftDown: false, trick: 'none', ...p,
  };
}

/**
 * Throttle that keeps the front wheel down.
 *
 * The acceleration and roll-in tests used to just pin it, which works on a
 * Grom and a YZ. It does not work on a 208 hp Streetfighter: that bike loops in
 * first gear with the rider fully forward, so "full throttle" measured a crash
 * rather than a launch. Real superbikes ship wheelie control for exactly this
 * reason - this is the harness's version of it.
 */
function launchThrottle(sim: BikeSim, want = 1): number {
  const over = sim.state.pitch / 0.10;
  return Math.max(0, Math.min(want, want * (1 - over)));
}

function newSim(ground: GroundProvider = flat) {
  const t = cloneTuning(SPEC);
  // Kill the random roll wander so results are repeatable run to run.
  t.balance.rollInstability = 0;
  return new BikeSim(t, ground, { x: 0, z: 0, yaw: 0 });
}

function run(
  label: string,
  seconds: number,
  control: (t: number, s: BikeSim) => RiderInput,
): { sim: BikeSim; maxPitch: number; maxSpeed: number; crashedAt: number | null; wheelieDist: number } {
  const sim = newSim();
  let maxPitch = 0;
  let maxSpeed = 0;
  let crashedAt: number | null = null;
  let wheelieDist = 0;
  let prevZ = sim.state.z;
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    sim.step(control(t, sim), DT);
    maxPitch = Math.max(maxPitch, sim.state.pitch);
    maxSpeed = Math.max(maxSpeed, sim.state.speed);
    if (sim.state.wheelieing) wheelieDist += Math.abs(sim.state.z - prevZ);
    prevZ = sim.state.z;
    if (sim.state.mode !== 'riding' && crashedAt === null) crashedAt = t;
  }
  void label;
  return { sim, maxPitch, maxSpeed, crashedAt, wheelieDist };
}

function row(name: string, value: string): void {
  console.log(`  ${name.padEnd(34)} ${value}`);
}

console.log(`\n=== WHEELIE LIFE PR · sim check · ${SPEC.name} ===\n`);

// --- 0. static numbers ----------------------------------------------------
{
  const sim = newSim();
  const t = sim.getTuning();
  const balance = Math.atan2(t.chassis.cgToRear, t.chassis.cgHeight) * RAD;
  console.log('BIKE');
  row('name', SPEC.name);
  row('peak power', `${(sim.engine.peakPowerKw() * 1.34102).toFixed(1)} hp`);
  row('peak torque', `${t.engine.peakTorque} Nm @ ${t.engine.peakTorqueRpm} rpm`);
  row('mass (bike + rider)', `${t.chassis.mass} kg`);
  row('balance point (neutral)', `${balance.toFixed(1)}°`);
  const shifted = Math.atan2(t.chassis.cgToRear - t.rider.weightShiftRange, t.chassis.cgHeight) * RAD;
  row('balance point (sat back)', `${shifted.toFixed(1)}°`);
  row('loops out at', `${(t.limits.crashPitch * RAD).toFixed(0)}°`);
  console.log('');
}

// --- 1. acceleration ------------------------------------------------------
{
  // Full throttle, no lift, upshift at the redline.
  const sim = newSim();
  const t = sim.getTuning();
  let to30 = 0, to60 = 0;
  let top = 0;
  for (let i = 0; i < 45 / DT; i++) {
    const s = sim.state;
    const up = s.rpm > t.engine.redlineRpm - 250 && s.gear < t.gearbox.gearRatios.length - 1;
    // Nose down on the bars, and back off if it starts lifting anyway, so this
    // measures drive rather than how fast the bike can loop itself.
    sim.step(input({ throttle: launchThrottle(sim), weight: -1, shiftUp: up }), DT);
    if (sim.state.mode !== 'riding') break;
    const mph = sim.state.speed * MPH;
    if (!to30 && mph >= 30) to30 = i * DT;
    if (!to60 && mph >= 60) to60 = i * DT;
    top = Math.max(top, mph);
  }
  console.log('ACCELERATION (front held down, shifting at redline)');
  row('0-30 mph', to30 ? `${to30.toFixed(2)} s` : 'never');
  row('0-60 mph', to60 ? `${to60.toFixed(2)} s` : 'never');
  row('top speed', `${top.toFixed(1)} mph (gear ${sim.state.gear + 1})`);
  console.log('');
}

// --- 2. can it loft in each gear? -----------------------------------------

/** Accelerate up into `gear`, arriving at a sensible mid-range rpm to lift at. */
function rollInto(gear: number): BikeSim | null {
  const sim = newSim();
  const t = sim.getTuning();
  let settle = 0;
  for (let i = 0; i < 30 / DT; i++) {
    const s = sim.state;
    // Wait for the shift to finish and the revs to settle, or we'd measure the
    // loft at the moment of the shift with the clutch still out.
    if (s.gear === gear && !s.shifting) {
      settle += DT;
      if (gear === 0 ? s.rpm > 5200 : settle > 0.25) return sim;
    }
    const up = s.gear < gear && s.rpm > t.engine.redlineRpm - 300 && !s.shifting;
    sim.step(input({ throttle: launchThrottle(sim), weight: -1, shiftUp: up }), DT);
    if (s.mode !== 'riding') return null;
  }
  return null;
}

{
  console.log('LOFT TEST (roll into each gear at mid-range, then pin it + pull back)');
  for (let gear = 0; gear < SPEC.gearbox.gearRatios.length; gear++) {
    const sim = rollInto(gear);
    if (!sim) { row(`gear ${gear + 1}`, 'could not reach gear'); continue; }
    const entrySpeed = sim.state.speed * MPH;
    const entryRpm = sim.state.rpm;
    let maxPitch = 0;
    for (let i = 0; i < 2.5 / DT; i++) {
      sim.step(input({ throttle: 1, weight: 1 }), DT);
      maxPitch = Math.max(maxPitch, sim.state.pitch);
      if (sim.state.mode !== 'riding') break;
    }
    const deg = maxPitch * RAD;
    const bp = sim.state.balancePoint * RAD;
    const verdict = sim.state.mode !== 'riding' ? 'LOOPS if you hold it'
      : deg > bp ? 'LOFTS past balance'
      : deg > 15 ? 'lifts, needs a bump or a better yank'
      : 'stays down';
    row(`gear ${gear + 1} (${entrySpeed.toFixed(0)} mph, ${entryRpm.toFixed(0)} rpm)`,
      `${deg.toFixed(0)}° — ${verdict}`);
  }
  console.log('');
}

// --- 3. does pinning it just loop you? ------------------------------------
{
  const r = run('loop', 8, () => input({ throttle: 1, weight: 1 }));
  console.log('LOOP TEST (throttle pinned, held back, no brake — should end badly)');
  row('max pitch', `${(r.maxPitch * RAD).toFixed(0)}°`);
  row('outcome', r.crashedAt !== null
    ? `looped at ${r.crashedAt.toFixed(2)} s — correct, mashing is punished`
    : 'never looped — pitch model is too forgiving');
  console.log('');
}

// --- 4. can the brake save it? --------------------------------------------
{
  // Loft it hard, and the moment it crosses the balance point: off the gas,
  // lean forward, stab the brake. This is the save the game is built around.
  const sim = newSim();
  let saved = false;
  let peak = 0;
  let reacted = false;
  let peakRate = 0;
  for (let i = 0; i < 10 / DT; i++) {
    const s = sim.state;
    if (!reacted && s.pitch > s.balancePoint) { reacted = true; peakRate = s.pitchRate; }
    const ctl = reacted
      ? input({ throttle: 0, brake: 0.8, weight: -1 })
      : input({ throttle: 1, weight: 1 });
    sim.step(ctl, DT);
    peak = Math.max(peak, s.pitch);
    if (reacted && s.pitch < 0.10 && s.mode === 'riding') { saved = true; break; }
    if (s.mode !== 'riding') break;
  }
  console.log('BRAKE SAVE (mash it, then off the gas + full brake at the balance point)');
  row('pitch rate when it went over', `${peakRate.toFixed(2)} rad/s`);
  row('peak pitch reached', `${(peak * RAD).toFixed(0)}°`);
  row('outcome', saved ? 'SAVED — brake brought the nose back down' : 'lost it anyway');
  console.log('');
}

/**
 * Stand-in for a skilled player: sits just under the balance point and rides the
 * throttle, exactly the way you actually hold a wheelie. If this can't hold one,
 * neither can a human.
 */
function autopilot(sim: BikeSim, i: number, opts: { shift: boolean }): RiderInput {
  const s = sim.state;
  const t = sim.getTuning();
  // Yank it up for the first third of a second, then settle in.
  if (i < 0.32 / DT) return input({ throttle: 1, weight: 1 });

  const target = s.balancePoint - 0.10;
  const u = -(s.pitch - target) * 4.5 - s.pitchRate * 1.7;
  const throttle = Math.max(0, Math.min(1, 0.42 + u));
  const brake = u < -0.55 ? Math.min(0.85, (-u - 0.55) * 1.6) : 0;
  const up = opts.shift && s.rpm > t.engine.redlineRpm - 200 && s.gear < 3 && !s.shifting;
  return input({ throttle, brake, weight: 0.75, shiftUp: up });
}

// --- 5. a good, held wheelie ----------------------------------------------
{
  const sim = newSim();
  let dist = 0;
  let time = 0;
  let peak = 0;
  let prevZ = 0;
  for (let i = 0; i < 40 / DT; i++) {
    const s = sim.state;
    sim.step(autopilot(sim, i, { shift: true }), DT);
    if (s.wheelieing) { dist += Math.abs(s.z - prevZ); time += DT; peak = Math.max(peak, s.pitch); }
    prevZ = s.z;
    if (s.mode !== 'riding') break;
  }
  console.log('HELD WHEELIE (autopilot riding just under the balance point)');
  row('distance', `${dist.toFixed(1)} m`);
  row('duration', `${time.toFixed(1)} s`);
  row('peak pitch', `${(peak * RAD).toFixed(0)}°`);
  row('top gear reached', String(sim.state.gear + 1));
  row('top speed while up', `${(sim.state.speed * MPH).toFixed(0)} mph`);
  row('ended', sim.state.mode === 'riding' ? 'still up at the buzzer' : `crashed (${sim.state.crashReason})`);
  console.log('');
}

// --- 6. shifting mid-wheelie drops the nose -------------------------------
{
  // Hold a steady wheelie with the autopilot (shifting disabled), then force one
  // upshift and watch what the torque cut does to the nose.
  // Two identical runs, one that shifts and one that doesn't, so the nose drop
  // is measured against what the bike would have done anyway.
  const trace = (doShift: boolean): { before: number; dip: number; end: number; alive: boolean } => {
    const sim = newSim();
    let before = 0;
    let dip = Infinity;
    let shiftAt = -1;
    let frozen: RiderInput | null = null;
    for (let i = 0; i < 20 / DT; i++) {
      const s = sim.state;
      let ctl = autopilot(sim, i, { shift: false });
      if (shiftAt < 0 && i > 2.5 / DT && s.pitch > 0.4 && !s.shifting) {
        shiftAt = i;
        before = s.pitch;
        frozen = { ...ctl };
        if (doShift) ctl = { ...ctl, shiftUp: true };
      }
      // Hold the pre-shift inputs for a beat: a human doesn't re-modulate inside
      // 200 ms, and letting the autopilot correct instantly hid the whole effect.
      if (shiftAt > 0 && frozen && i - shiftAt < 0.45 / DT) {
        ctl = { ...frozen, shiftUp: ctl.shiftUp };
      }
      if (shiftAt > 0 && i - shiftAt < 0.6 / DT) dip = Math.min(dip, s.pitch);
      if (shiftAt > 0 && i - shiftAt > 1.5 / DT) {
        return { before, dip, end: s.pitch, alive: s.mode === 'riding' };
      }
      sim.step(ctl, DT);
      if (s.mode !== 'riding') return { before, dip, end: s.pitch, alive: false };
    }
    return { before, dip, end: sim.state.pitch, alive: sim.state.mode === 'riding' };
  };

  const shifted = trace(true);
  const held = trace(false);
  console.log('UPSHIFT MID-WHEELIE (the torque cut should drop the nose)');
  row('pitch at the shift', `${(shifted.before * RAD).toFixed(1)}°`);
  row('lowest pitch, shifted', `${(shifted.dip * RAD).toFixed(1)}°`);
  row('lowest pitch, no shift', `${(held.dip * RAD).toFixed(1)}°`);
  const drop = (held.dip - shifted.dip) * RAD;
  row('nose drop caused by shift', `${drop.toFixed(1)}°`);
  row('effect', drop > 1.5
    ? 'the shift is felt — timing the pull-back through it is a real skill'
    : 'barely felt — lengthen gearbox.shiftTimeUp');
  row('rideable through it', shifted.alive ? 'yes — recoverable' : 'dropped it');
  console.log('');
}

// --- 7. speed bumps ------------------------------------------------------
{
  // How much a bump adds in a gear that is hard to lift in. On the Grom this is
  // the only way into a 3rd-gear wheelie at all; on the YZ it is a bonus, since
  // that bike lofts in three gears on power.
  const BUMP_Z = 160;
  console.log('SPEED BUMP in 3rd (how much does timing the pull over one add?)');
  for (const [label, pull] of [['just ride over it', false], ['pull back over it', true]] as const) {
    for (const approach of [25, 42]) {
      const target = approach / MPH;
      const sim = newSim(withBump(BUMP_Z));
      // Get into 3rd...
      for (let i = 0; i < 20 / DT; i++) {
        const s = sim.state;
        if (s.gear === 2 && !s.shifting) break;
        sim.step(input({
          throttle: launchThrottle(sim), weight: -1,
          shiftUp: s.gear < 2 && s.rpm > SPEC.engine.redlineRpm - 300 && !s.shifting,
        }), DT);
        if (s.mode !== 'riding') break;
      }
      // ...then settle onto the approach speed, still well short of the bump.
      let reached = false;
      for (let i = 0; i < 30 / DT; i++) {
        const s = sim.state;
        const err = target - s.speed;
        if (Math.abs(err) < 0.25 && s.z < BUMP_Z - 25) { reached = true; break; }
        if (s.z > BUMP_Z - 12) break;
        sim.step(input({
          throttle: err > 0 ? launchThrottle(sim, Math.min(1, err * 0.6 + 0.35)) : 0,
          brake: err < -0.4 ? Math.min(0.5, -err * 0.12) : 0,
          weight: -1,
        }), DT);
        if (s.mode !== 'riding') break;
      }
      if (!reached) { row(`${label} @ ${approach} mph`, 'could not set up'); continue; }
      const entry = sim.state.speed * MPH;
      let maxPitch = 0;
      let crashed = false;
      for (let i = 0; i < 12 / DT; i++) {
        const s = sim.state;
        // Hold the approach speed, then yank as the front meets the face.
        const onIt = pull && s.z > BUMP_Z - 1.9 && s.z < BUMP_Z + 1.2;
        const throttle = s.speed < target ? 0.75 : 0.35;
        sim.step(input({ throttle: onIt ? 1 : throttle, weight: onIt ? 1 : -0.2 }), DT);
        if (s.z > BUMP_Z - 3) maxPitch = Math.max(maxPitch, s.pitch);
        if (s.mode !== 'riding') { crashed = true; break; }
        if (s.z > BUMP_Z + 45) break;
      }
      const deg = maxPitch * RAD;
      const verdict = crashed ? 'LOOPED - too much'
        : deg > 25 ? 'proper wheelie off the bump'
        : deg > 8 ? 'front comes up'
        : 'barely noticed it';
      row(`${label} @ ${entry.toFixed(0)} mph`, `peak ${deg.toFixed(0)}° — ${verdict}`);
    }
  }
  console.log('');
}

// --- 8. side-to-side: lean, not fall -------------------------------------
{
  console.log('ROLL (should read as leaning, and the stick must catch it)');

  // The one place the harness does NOT zero out instability.
  const real = () => new BikeSim(cloneTuning(SPEC), flat, { x: 0, z: 0, yaw: 0 });

  /** Hold a wheelie with the autopilot while `steer` drives the roll axis. */
  function rollRun(seconds: number, steer: (t: number, roll: number) => number) {
    const sim = real();
    let peak = 0;
    let t = 0;
    for (let i = 0; i < seconds / DT; i++) {
      const s = sim.state;
      const ctl = { ...autopilot(sim, i, { shift: true }), steer: steer(i * DT, s.roll) };
      sim.step(ctl, DT);
      if (s.wheelieing) {
        t += DT;
        if (Math.abs(s.roll) > Math.abs(peak)) peak = s.roll;
      }
      if (s.mode !== 'riding') break;
    }
    return { sim, peak, upFor: t };
  }

  // a) Sign check, in the sim rather than by eye.
  {
    const r = rollRun(6, (t) => (t > 1.2 ? 1 : 0));
    const roll = r.sim.state.roll * RAD;
    row('stick right ->', `${roll > 0.5 ? 'leans RIGHT' : roll < -0.5 ? 'leans LEFT' : 'no lean'} (${roll.toFixed(1)}°)`);
    row('  expected', 'leans RIGHT');
  }

  // b) Hands off the roll axis: should be a slow lean you have time to notice.
  {
    let lowsides = 0;
    let sumPeak = 0;
    let sumUp = 0;
    const RUNS = 12;
    for (let n = 0; n < RUNS; n++) {
      const r = rollRun(25, () => 0);
      sumPeak += Math.abs(r.peak) * RAD;
      sumUp += r.upFor;
      if (r.sim.state.crashReason === 'lowside') lowsides++;
    }
    row('no steer input, avg drift', `${(sumPeak / RUNS).toFixed(1)}° of lean`);
    row('avg time up', `${(sumUp / RUNS).toFixed(1)} s`);
    row('lowsided', `${lowsides} of ${RUNS} runs`);
  }

  // c) Can a deliberate correction pull a bad lean back? Measured as time to
  //    return to near-upright once you push the other way.
  {
    const sim = real();
    let pushedTo = 0;
    let correctingFrom = -1;
    let recovered = -1;
    for (let i = 0; i < 20 / DT; i++) {
      const s = sim.state;
      // Lean it hard right, then hold left until it comes back up.
      const steer = correctingFrom < 0 ? 1 : -1;
      if (correctingFrom < 0 && s.roll > 0.42) { correctingFrom = i * DT; pushedTo = s.roll; }
      if (correctingFrom >= 0 && recovered < 0 && s.roll < 0.09) recovered = i * DT - correctingFrom;
      sim.step({ ...autopilot(sim, i, { shift: true }), steer }, DT);
      if (s.mode !== 'riding') break;
      if (recovered >= 0) break;
    }
    row('leaned over to', `${(pushedTo * RAD).toFixed(1)}°`);
    row('opposite stick pulls it back in',
      recovered >= 0 ? `${recovered.toFixed(2)} s — recoverable`
        : correctingFrom < 0 ? 'never got that far over' : 'did not recover');
  }
  console.log('');
}

// ---- reverse -------------------------------------------------------------
// You have to be able to steer while paddling backwards, or the only way out of
// a corner is to crash on purpose. The authority used to be gated on
// `smoothstep(0, 1.2, speed)`, which is zero the moment the speed goes
// negative, so reverse was a straight line.
{
  console.log('REVERSE (paddling backwards off a wall)');
  const back = (steer: number) => {
    const sim = new BikeSim(cloneTuning(SPEC), flat, { x: 0, z: 0, yaw: 0 });
    sim.reset({ x: 0, z: 0, yaw: 0, speed: 0, gear: 0 });
    for (let t = 0; t < 4; t += DT) {
      sim.step({
        throttle: 0, brake: 1, steer, weight: 0,
        shiftUp: false, shiftDown: false, trick: 'none',
      }, DT);
    }
    return { yaw: sim.state.yaw * RAD, speed: sim.state.speed };
  };
  const straight = back(0);
  const left = back(-1);
  const right = back(1);
  row('backs up at', `${(-straight.speed).toFixed(2)} m/s`);
  row('holds a line with no steer', `${Math.abs(straight.yaw).toFixed(1)}° off`);
  row('4 s of bars left', `${left.yaw.toFixed(0)}°`);
  row('4 s of bars right', `${right.yaw.toFixed(0)}°`);
  row('steers at all',
    Math.abs(left.yaw) > 15 ? 'yes' : 'NO — reverse is stuck straight');
  row('turns opposite ways, like backing a car',
    Math.sign(left.yaw) !== Math.sign(right.yaw) ? 'yes' : 'NO');
  console.log('');
}

console.log('=========================================================\n');
