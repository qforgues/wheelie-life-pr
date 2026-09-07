/**
 * Can you get out of the map?
 *
 * Floods every open cell reachable from the middle of the city and checks where
 * it stops. This found the leak that the fence was built to close: out through
 * the plaza's opening to the sea, round the ends of the sea wall, and then all
 * the way round the outside of the city on ten hectares of blank grass, because
 * the boundary walls stopped four metres past the opening and nothing closed
 * the flanks.
 *
 * It runs on every build because a leak like that is invisible until somebody
 * rides into it, and adding one road in the wrong place re-opens it.
 *
 *   npm run edges
 */
import './domstub';
import { City, LAYOUT, MAP } from '../src/world/City';

const R = 0.42;
const STEP = 2;
/** How far past the map to search. If the fill gets this far it has escaped. */
const PAD = 80;

const city = new City();
const x0 = MAP.xMin - PAD;
const z0 = MAP.zMin - PAD;
const w = Math.ceil(((MAP.xMax + PAD) - x0) / STEP) + 1;
const h = Math.ceil(((MAP.zMax + PAD) - z0) / STEP) + 1;
const seen = new Uint8Array(w * h);
const idx = (i: number, j: number) => j * w + i;
const open = (i: number, j: number) => !city.blocked(x0 + i * STEP, z0 + j * STEP, R);

const si = Math.round((0 - x0) / STEP);
const sj = Math.round((280 - z0) / STEP);
const stack: Array<[number, number]> = [[si, sj]];
seen[idx(si, sj)] = 1;
let cells = 0;
let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
while (stack.length) {
  const [i, j] = stack.pop()!;
  cells++;
  const x = x0 + i * STEP;
  const z = z0 + j * STEP;
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (z < minZ) minZ = z;
  if (z > maxZ) maxZ = z;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
    if (seen[idx(ni, nj)]) continue;
    seen[idx(ni, nj)] = 1;
    if (open(ni, nj)) stack.push([ni, nj]);
  }
}

/** The fence line: everything the player can reach must be inside this. */
const EDGE = LAYOUT.roadHalf + LAYOUT.sidewalk + LAYOUT.blockDepth + 4;
const bound = {
  minX: MAP.xMin - EDGE, maxX: MAP.xMax + EDGE,
  minZ: MAP.zMin - EDGE,
  // The plaza runs on past the north fence line to its own sea wall.
  maxZ: LAYOUT.seaWallZ,
};

console.log('');
console.log('=========================================================');
console.log('THE EDGE OF THE MAP — what a rider can actually reach');
console.log('');
console.log(`  roads span      x ${MAP.xMin}..${MAP.xMax}   z ${MAP.zMin}..${MAP.zMax}`);
console.log(`  fence line      x ${bound.minX}..${bound.maxX}   z ${bound.minZ}..${bound.maxZ}`);
console.log(`  reachable       x ${minX}..${maxX}   z ${minZ}..${maxZ}`);
console.log(`  ${cells.toLocaleString()} open cells, ${(cells * STEP * STEP / 10000).toFixed(1)} hectares`);
console.log('');

const problems: string[] = [];
const slack = STEP + R + 0.5;
if (minX < bound.minX - slack) problems.push(`escapes west to x=${minX} (fence at ${bound.minX})`);
if (maxX > bound.maxX + slack) problems.push(`escapes east to x=${maxX} (fence at ${bound.maxX})`);
if (minZ < bound.minZ - slack) problems.push(`escapes south to z=${minZ} (fence at ${bound.minZ})`);
if (maxZ > bound.maxZ + slack) problems.push(`escapes north to z=${maxZ} (sea wall at ${bound.maxZ})`);

if (problems.length) {
  console.log('  PROBLEMS — there is a way out of the map');
  for (const p of problems) console.log(`    - ${p}`);
  console.log('=========================================================');
  process.exit(1);
}
console.log('  sealed on all four sides');
console.log('=========================================================');
