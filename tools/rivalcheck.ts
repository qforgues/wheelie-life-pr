/**
 * Headless rival harness.
 *
 * Runs Los Piratas for four simulated minutes with nobody watching and checks
 * the two things that are invisible until they are wrong:
 *
 *   1. They stay on the road. This one has already earned its keep - the first
 *      version put a wheel 7.2 m off the centreline and onto the pavement at
 *      every corner, and it looked fine in a screenshot.
 *   2. They actually wheelie, and the three temperaments come out different.
 *
 *   npm run rivals
 */
import { Rivals } from '../src/world/Rivals';
import { LAYOUT } from '../src/world/City';

const DT = 1 / 60;
const MINUTES = 4;
/** The kerb, less enough room for a set of bars. */
const LIMIT = LAYOUT.roadHalf - 1;

/** Distance from the nearest centreline of either kind. */
function offCentre(x: number, z: number): number {
  let dx = Infinity;
  for (const ax of LAYOUT.avenueX) dx = Math.min(dx, Math.abs(x - ax));
  let dz = Infinity;
  for (const sz of LAYOUT.streetZ) dz = Math.min(dz, Math.abs(z - sz));
  return Math.min(dx, dz);
}

const rivals = new Rivals();
rivals.setCount('crew');

// A player parked at the middle junction, so the gather radius has something
// to aim at and the hail path gets exercised.
const PX = 0;
const PZ = 280;

let worst = 0;
let worstAt = '';
let frames = 0;
let lofted = 0;
let hails = 0;
const met = new Set<string>();
let closest = Infinity;
const riders = (rivals as unknown as { riders: Array<{ spec: { name: string }; drawX: number; drawZ: number; loft: number }> }).riders;

for (let t = 0; t < MINUTES * 60; t += DT) {
  const report = rivals.update(DT, PX, PZ);
  frames++;
  if (report.hail) { hails++; met.add(report.hail.name); }
  for (const r of riders) {
    const off = offCentre(r.drawX, r.drawZ);
    if (off > worst) {
      worst = off;
      worstAt = `${r.spec.name} at (${r.drawX.toFixed(1)}, ${r.drawZ.toFixed(1)}), t=${t.toFixed(1)}s`;
    }
    if (r.loft > 0.5) lofted++;
    closest = Math.min(closest, Math.hypot(r.drawX - PX, r.drawZ - PZ));
  }
}

const pad = (s: string, n: number) => s.padEnd(n);

// Winning a battle must not hand you a crash. The crew go non-solid for the
// race, and if they came back the instant it ended you would be standing inside
// somebody. Ride to a stop on top of one and check.
const solidAfter: string[] = [];
{
  const r2 = new Rivals();
  r2.setCount('crew');
  const inner = (r2 as unknown as { riders: Array<{ drawX: number; drawZ: number }> }).riders;
  r2.battling = true;
  r2.update(DT, inner[0].drawX, inner[0].drawZ);
  if (r2.hits(inner[0].drawX, inner[0].drawZ, 0.42)) solidAfter.push('solid DURING a battle');
  r2.endRace();
  // Sit on top of them for four seconds - longer than the grace - and they must
  // still not be solid, because you have not moved off them.
  for (let t = 0; t < 4; t += DT) {
    r2.update(DT, inner[0].drawX, inner[0].drawZ);
    if (r2.hits(inner[0].drawX, inner[0].drawZ, 0.42)) {
      solidAfter.push(`solid again after ${t.toFixed(1)}s while still on top of them`);
      break;
    }
  }
  // Ride away and they come back to being an obstacle, or nothing is ever solid.
  let cameBack = false;
  for (let t = 0; t < 6; t += DT) {
    r2.update(DT, 0, -900);
    if (r2.hits(inner[1].drawX, inner[1].drawZ, 0.42)) { cameBack = true; break; }
  }
  if (!cameBack) solidAfter.push('the crew never became solid again after a battle');
}

console.log('');
console.log('=========================================================');
console.log(`LOS PIRATAS — ${riders.length} out, ${MINUTES} minutes`);
console.log('');
console.log(`  ${pad('furthest off a centreline', 34)} ${worst.toFixed(2)} m  (kerb at ${LAYOUT.roadHalf})`);
console.log(`  ${pad('', 34)} ${worstAt}`);
console.log(`  ${pad('front wheel up', 34)} ${(lofted / (frames * riders.length) * 100).toFixed(1)}% of rider-frames`);
console.log(`  ${pad('closest anyone came to the player', 34)} ${closest.toFixed(1)} m`);
console.log(`  ${pad('riders who said something', 34)} ${met.size} of ${riders.length}, ${hails} hails`);
console.log('');
console.log(`  ${pad('solid again only once you ride clear', 34)} ${solidAfter.length === 0 ? 'yes' : solidAfter.join('; ')}`);
console.log('');
console.log('  best wheelie, by rider');
for (const s of rivals.standings) console.log(`    ${pad(s.name, 12)} ${s.best.toFixed(1)} m`);
console.log('');

const problems: string[] = [...solidAfter];
if (worst > LIMIT) problems.push(`a rider got ${worst.toFixed(2)} m off the centreline — past the ${LIMIT} m kerb line (${worstAt})`);
if (lofted / (frames * riders.length) < 0.15) problems.push('hardly anybody is wheelieing — the street should be full of it');
if (met.size < riders.length - 1) problems.push(`only ${met.size} of ${riders.length} riders ever came near the player`);
const best = rivals.standings;
if (best[0].best < 50) problems.push('nobody managed a run worth watching');
if (best[best.length - 1].best > best[0].best * 0.6) problems.push('every rider rides the same — the temperaments are not telling apart');

if (problems.length) {
  console.log('  PROBLEMS');
  for (const p of problems) console.log(`    - ${p}`);
  console.log('=========================================================');
  process.exit(1);
}
console.log('  all good');
console.log('=========================================================');
