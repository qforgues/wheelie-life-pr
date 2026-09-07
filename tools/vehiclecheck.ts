/**
 * Headless scene-cost harness.
 *
 * Draw calls are the metric here, not frame time - the same scene has measured
 * 19 ms, 7 ms and 2.6 ms depending only on whether the tab was focused, so a
 * timing is not evidence. This counts what is actually submitted, which is.
 *
 * It checks three things, and has already earned all three:
 *
 *   1. Every vehicle stays baked. An unbaked ATV is 19 draw calls instead of 7
 *      and a Hummer is 23 instead of 6 - and ICE puts twelve Hummers out, which
 *      was 276 draw calls of police in a frame the city renders in ~530.
 *   2. The animated lights survive baking AND cloning. They are found by name
 *      on a clone, so a rename or a missing one silently kills every siren.
 *   3. No two materials share a recipe by accident, and the bomba's beacon does
 *      NOT share one with the patrol light bars - it is the same red at the
 *      same intensity, so through the material cache they become one object
 *      with two things writing to it.
 *
 *   npm run scene
 */
import './domstub';
import * as THREE from 'three';
import {
  makeCar, makeATV, makeScooter, makePoliceCar, makeHummer, makeFireTruck,
} from '../src/world/Props';
import { City } from '../src/world/City';

const problems: string[] = [];

function cost(root: THREE.Object3D): { calls: number; tris: number; mats: number } {
  let calls = 0;
  let tris = 0;
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    calls++;
    for (const mm of (Array.isArray(m.material) ? m.material : [m.material])) mats.add(mm);
    tris += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
  });
  return { calls, tris: Math.round(tris), mats: mats.size };
}

console.log('');
console.log('=========================================================');
console.log('VEHICLES — draw calls each, and the budget they must stay under');
console.log('');
const patrol = makePoliceCar(false);
const riot = makePoliceCar(true);
const hummer = makeHummer();
const bomba = makeFireTruck();
const fleet: Array<[string, THREE.Object3D, number]> = [
  ['traffic car', makeCar(0xd8453f), 8],
  ['cuatrimoto', makeATV(0x2f7a4a), 8],
  ['chuma', makeScooter(0xd8a021), 9],
  ['patrol', patrol.group, 10],
  ['ICE hummer', hummer.group, 8],
  ['la bomba', bomba.group, 8],
];
for (const [name, obj, budget] of fleet) {
  const c = cost(obj);
  const over = c.calls > budget;
  console.log(`  ${name.padEnd(13)} ${String(c.calls).padStart(3)} calls (budget ${budget})  ${String(c.tris).padStart(5)} tris  ${c.mats} materials${over ? '   <-- OVER' : ''}`);
  if (over) problems.push(`${name} is ${c.calls} draw calls, over its budget of ${budget} — has it stopped being baked?`);
}

console.log('');
console.log('  animated lights, found by name on a clone');
const lights: Array<[string, unknown]> = [
  ['patrol red', patrol.lights[0]], ['patrol blue', patrol.lights[1]],
  ['riot amber', riot.lights[0]], ['riot white', riot.lights[1]],
  ['hummer red', hummer.lights[0]], ['hummer blue', hummer.lights[1]],
  ['bomba beacon', bomba.beacon],
];
for (const [name, m] of lights) {
  if (!m) problems.push(`${name} is missing — the siren will not flash`);
}
console.log(`    ${lights.filter(([, m]) => m).length} of ${lights.length} present`);

// Two patrols must be separate objects, or they all move together.
const other = makePoliceCar(false);
if (other.group === patrol.group) problems.push('two patrols are the same object');
// And the bomba must not be wired into the patrol light bars.
if ((bomba.beacon as THREE.Mesh).material === (patrol.lights[0] as THREE.Mesh).material) {
  problems.push('the bomba beacon shares a material with the patrol light bars — they will fight over it');
}

// ---- the city ------------------------------------------------------------
const city = new City();
const seen = new Map<string, number>();
let cityCalls = 0;
let cityTris = 0;
city.root.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry) return;
  cityCalls++;
  cityTris += m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
  for (const mm of (Array.isArray(m.material) ? m.material : [m.material])) {
    const s = mm as THREE.MeshStandardMaterial;
    const key = `${mm.type}|${s.color ? s.color.getHexString() : '-'}|${s.map ? s.map.uuid : '-'}|${s.roughness}|${s.metalness}|${mm.transparent}|${mm.side}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
});
const mats = new Set<THREE.Material>();
city.root.traverse((o) => {
  const m = o as THREE.Mesh;
  if (m.isMesh) for (const mm of (Array.isArray(m.material) ? m.material : [m.material])) mats.add(mm);
});

// What a cell-culled camera actually submits from the busiest spot on the map.
const cells = (city as unknown as { cells: Array<{ group: THREE.Group; cx: number; cz: number }> }).cells;
let worst = 0;
let worstAt = '';
for (const [label, px, pz] of [
  ['spawn', 0, -10], ['middle junction', 0, 280], ['plaza', 0, 640],
  ['south-west corner', -240, -40], ['against the fence', -240, -60],
] as const) {
  let calls = 0;
  for (const c of cells) {
    if (Math.hypot(c.cx - px, c.cz - pz) > 320) continue;
    c.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) calls++; });
  }
  if (calls > worst) { worst = calls; worstAt = label; }
}

console.log('');
console.log('CITY');
console.log(`  ${String(cityCalls).padStart(5)} meshes, ${Math.round(cityTris).toLocaleString()} triangles, ${city.cellCount} cells`);
console.log(`  ${String(mats.size).padStart(5)} materials over ${seen.size} distinct recipes`);
console.log(`  ${String(worst).padStart(5)} meshes in cull range at the worst spot (${worstAt})`);
console.log('');

const CITY_BUDGET = 1700;
const MATERIAL_SLACK = 20;
if (worst > CITY_BUDGET) {
  problems.push(`${worst} meshes in range at ${worstAt}, over the budget of ${CITY_BUDGET}`);
}
if (mats.size > seen.size + MATERIAL_SLACK) {
  problems.push(`${mats.size} materials for ${seen.size} recipes — ${mats.size - seen.size} duplicates. Route them through view/materials.ts.`);
}

if (problems.length) {
  console.log('  PROBLEMS');
  for (const p of problems) console.log(`    - ${p}`);
  console.log('=========================================================');
  process.exit(1);
}
console.log('  all within budget');
console.log('=========================================================');
