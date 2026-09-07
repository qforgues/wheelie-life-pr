import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makePalmFrondTexture, makeSignTexture } from './textures';
import { bakeSubtree, mergeMeshes, roundedBox } from '../view/geometry';

/** Street furniture. Everything here is cheap boxes and cylinders, lit well. */

let frondTex: THREE.Texture | null = null;
function getFrondTexture(): THREE.Texture {
  if (!frondTex) frondTex = makePalmFrondTexture();
  return frondTex;
}

const SHARED = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x8a7a5f, roughness: 0.95 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.55, metalness: 0.6 }),
  glassWarm: new THREE.MeshStandardMaterial({
    color: 0xffe6b0, emissive: 0xffd68a, emissiveIntensity: 0.35, roughness: 0.3,
  }),
  terracotta: new THREE.MeshStandardMaterial({ color: 0xb5643f, roughness: 0.9 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.95 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x2f7a37, roughness: 0.85 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.9 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 }),
  glassCool: new THREE.MeshStandardMaterial({
    color: 0x2a3a4a, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.85,
  }),
};

/**
 * Palms, railings and planters, cached by shape.
 *
 * These are built per instance and were the single biggest block of geometry
 * in the city - 168 unique palms was 40% of every vertex in the scene, all of
 * them subtly different heights nobody could pick out. Rounding the inputs to a
 * few buckets and sharing the result costs nothing visually and is the
 * difference between the console rendering the city and running out of memory
 * trying. `clone()` shares the underlying geometry, so each copy is just a
 * transform.
 */
const PROP_CACHE = new Map<string, THREE.Group>();

function cached(key: string, build: () => THREE.Group): THREE.Group {
  let proto = PROP_CACHE.get(key);
  if (!proto) {
    proto = build();
    PROP_CACHE.set(key, proto);
  }
  return proto.clone(true);
}

/** Rounds to a step so shapes repeat and their geometry can be shared. */
function bucket(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function makePalm(height = 7, seed = 0): THREE.Group {
  // Four heights and four leanings is plenty of variety down a street.
  const h = bucket(height, 1.2);
  const s = Math.abs(Math.round(seed)) % 4;
  return cached(`palm:${h}:${s}`, () => buildPalm(h, s));
}

function buildPalm(height = 7, seed = 0): THREE.Group {
  const g = new THREE.Group();
  const rnd = (n: number) => Math.sin(seed * 12.9898 + n * 78.233) * 0.5 + 0.5;

  // Curved trunk built from a few stacked, offset segments.
  const segs = 8;
  const lean = (rnd(1) - 0.5) * 0.5;
  const trunkParts: THREE.Mesh[] = [];
  let y = 0;
  for (let i = 0; i < segs; i++) {
    const h = height / segs;
    const r0 = 0.19 - (i / segs) * 0.09;
    const r1 = 0.19 - ((i + 1) / segs) * 0.09;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h * 1.02, 12), SHARED.trunk);
    const t = i / segs;
    seg.position.set(lean * t * t * height * 0.25, y + h / 2, 0);
    seg.rotation.z = -lean * t * 0.25;
    trunkParts.push(seg);
    y += h;
  }
  g.add(mergeMeshes(trunkParts, SHARED.trunk));

  const topX = lean * height * 0.25;
  const crown = new THREE.Group();
  crown.position.set(topX, y - 0.1, 0);
  g.add(crown);

  const frondMat = new THREE.MeshStandardMaterial({
    map: getFrondTexture(),
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });

  // Each frond hangs off its own base at the crown, so it can be swung round
  // and drooped independently instead of every plane radiating from the centre.
  const count = 12;
  const frondGeo = new THREE.PlaneGeometry(3.1, 1.55);
  for (let i = 0; i < count; i++) {
    const azimuth = new THREE.Group();
    azimuth.rotation.y = -((i / count) * Math.PI * 2 + rnd(i) * 0.4);
    const droop = new THREE.Group();
    // Outer ring hangs low, inner ring stands up - that layering is most of
    // what makes a palm read as a crown rather than a starburst.
    const outer = i % 3 !== 0;
    droop.rotation.z = -(outer ? 0.55 + rnd(i + 5) * 0.45 : 0.05 + rnd(i + 9) * 0.2);
    const f = new THREE.Mesh(frondGeo, frondMat);
    f.position.set(1.5, 0, 0);
    f.rotation.x = -Math.PI / 2;
    f.castShadow = true;
    droop.add(f);
    azimuth.add(droop);
    if (outer) azimuth.scale.setScalar(0.85 + rnd(i + 2) * 0.3);
    crown.add(azimuth);
  }

  // Bake the whole crown down to one mesh - 12 fronds each behind their own
  // pair of pivot groups is 12 draw calls per tree otherwise.
  crown.updateMatrixWorld(true);
  const fronds: THREE.Mesh[] = [];
  crown.traverse((o) => { if ((o as THREE.Mesh).isMesh) fronds.push(o as THREE.Mesh); });
  const bakedCrown = mergeMeshes(
    fronds.map((f) => { const c = f.clone(); c.matrixAutoUpdate = false; c.matrix.copy(f.matrixWorld); return c; }),
    frondMat,
  );
  crown.clear();
  g.remove(crown);
  g.add(bakedCrown);

  // Coconuts tucked under the crown.
  const nuts: THREE.Mesh[] = [];
  const nutGeo = new THREE.SphereGeometry(0.15, 12, 10);
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(nutGeo, SHARED.trunk);
    const a = (i / 4) * Math.PI * 2;
    c.position.set(topX + Math.cos(a) * 0.28, y - 0.28, Math.sin(a) * 0.28);
    nuts.push(c);
  }
  g.add(mergeMeshes(nuts, SHARED.trunk));
  nutGeo.dispose();
  return g;
}

/**
 * Wrought-iron railing running along Z, thin in X. Used on the balconies and
 * along the sea wall - as a solid slab it read as a black wall, which is what
 * the balconies looked like from the street.
 */
export function makeRailing(length: number, height = 0.85, spacing = 0.16): THREE.Group {
  const l = Math.max(0.4, bucket(length, 0.5));
  return cached(`rail:${l}:${height}:${spacing}`, () => buildRailing(l, height, spacing));
}

function buildRailing(length: number, height = 0.85, spacing = 0.16): THREE.Group {
  const g = new THREE.Group();
  const parts: THREE.Mesh[] = [];

  const railGeo = new THREE.CylinderGeometry(0.022, 0.022, length, 8);
  for (const y of [height, height * 0.52, 0.03]) {
    const rail = new THREE.Mesh(railGeo, SHARED.iron);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = y;
    parts.push(rail);
  }
  const count = Math.max(2, Math.round(length / spacing));
  const barGeo = new THREE.CylinderGeometry(0.013, 0.013, height, 6);
  for (let i = 0; i <= count; i++) {
    const bar = new THREE.Mesh(barGeo, SHARED.iron);
    bar.position.set(0, height / 2, -length / 2 + (i / count) * length);
    parts.push(bar);
  }
  // Slightly heavier posts at each end.
  const postGeo = new THREE.CylinderGeometry(0.024, 0.024, height + 0.08, 8);
  for (const z of [-length / 2, length / 2]) {
    const post = new THREE.Mesh(postGeo, SHARED.iron);
    post.position.set(0, (height + 0.08) / 2, z);
    parts.push(post);
  }

  g.add(mergeMeshes(parts, SHARED.iron));
  railGeo.dispose();
  barGeo.dispose();
  postGeo.dispose();
  return g;
}

/** Colonial cast-iron street lamp, the ones all over Old San Juan. */
export function makeStreetLamp(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({
    color: 0xfff0c8, emissive: 0xffd98a, emissiveIntensity: 0.55,
    roughness: 0.25, transparent: true, opacity: 0.9,
  });

  const iron: THREE.Mesh[] = [];
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.45, 14), SHARED.iron);
  base.position.y = 0.22;
  iron.push(base);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.12, 14), SHARED.iron);
  collar.position.y = 0.5;
  iron.push(collar);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.08, 3.5, 14), SHARED.iron);
  post.position.y = 2.3;
  iron.push(post);

  // Scrolled arm reaching out over the pavement, with the lantern hung off the
  // far end of it rather than floating alongside.
  const arm = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.035, 8, 20, Math.PI / 2), SHARED.iron,
  );
  arm.position.set(0, 4.05, 0);
  arm.rotation.set(Math.PI / 2, 0, Math.PI);
  iron.push(arm);

  const HANG = 0.34;
  const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), SHARED.iron);
  hanger.position.set(HANG, 4.31, 0);
  iron.push(hanger);

  // Four-sided lantern: cap on top, glass body tapering down, finial beneath.
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.20, 4), SHARED.iron);
  cap.position.set(HANG, 4.16, 0);
  cap.rotation.y = Math.PI / 4;
  iron.push(cap);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.10, 0.42, 4), glass);
  body.position.set(HANG, 3.85, 0);
  body.rotation.y = Math.PI / 4;
  g.add(body);
  // Corner ribs so it reads as a glazed lantern, not a blob of light.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 6), SHARED.iron);
    rib.position.set(HANG + Math.cos(a) * 0.115, 3.85, Math.sin(a) * 0.115);
    iron.push(rib);
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), SHARED.iron);
  finial.position.set(HANG, 3.62, 0);
  iron.push(finial);

  g.add(mergeMeshes(iron, SHARED.iron));
  return g;
}

/** Terracotta planter spilling bougainvillea. */
export function makePlanter(seed = 0): THREE.Group {
  return cached(`planter:${Math.abs(Math.round(seed)) % 4}`, () => buildPlanter(seed));
}

function buildPlanter(seed = 0): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.55, 10), SHARED.terracotta);
  pot.position.y = 0.28;
  pot.castShadow = true;
  g.add(pot);
  const bloomColors = [0xd6417a, 0xe0653f, 0xc23b8f, 0xe89a3c];
  for (let i = 0; i < 9; i++) {
    const r = 0.16 + ((i * 37 + seed * 13) % 10) / 40;
    const mat = new THREE.MeshStandardMaterial({
      color: i % 3 === 0 ? SHARED.leaf.color : bloomColors[(i + seed) % bloomColors.length],
      roughness: 0.9,
    });
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), mat);
    const a = (i / 9) * Math.PI * 2 + seed;
    b.position.set(Math.cos(a) * 0.3, 0.62 + ((i * 17) % 7) / 12, Math.sin(a) * 0.3);
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

/**
 * A parked car. No traffic in the prototype - these are obstacles and scenery.
 *
 * These sit at eye level right beside the player, so they were the blockiest
 * thing on screen once the bike was rounded. Built now as a proper silhouette:
 * sill, body, tapered greenhouse, arches and bumpers.
 */
/**
 * A car, baked down to one mesh per material.
 *
 * Built naively this is ~19 meshes, which was fine while cars were scenery.
 * Now that traffic drives there can be sixteen of them on screen and that is
 * 300 draw calls the Xbox does not have. The shapes are merged once, cached,
 * and shared by every car; only the paint material differs, so a full street of
 * traffic costs seven draw calls each and almost no extra memory.
 */
interface CarParts {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  tyre: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
}

let CAR_PARTS: CarParts | null = null;
const CAR_PAINT = new Map<number, THREE.MeshStandardMaterial>();
const CAR_HEAD = new THREE.MeshStandardMaterial({
  color: 0xf6f2e2, emissive: 0x2a2a24, roughness: 0.15, metalness: 0.3,
});
const CAR_TAIL = new THREE.MeshStandardMaterial({ color: 0xa8202a, roughness: 0.3 });
const CAR_DARK = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.7 });

/** Merges a set of positioned geometries into one, consuming the inputs. */
function bake(parts: Array<[THREE.BufferGeometry, THREE.Matrix4]>): THREE.BufferGeometry {
  const geos = parts.map(([g, m]) => {
    const c = g.clone();
    c.applyMatrix4(m);
    c.clearGroups();
    for (const name of Object.keys(c.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') c.deleteAttribute(name);
    }
    return c;
  });
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return merged;
}

const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );

function carParts(): CarParts {
  if (CAR_PARTS) return CAR_PARTS;

  const wheels: Array<[number, number]> = [[-0.83, 1.36], [0.83, 1.36], [-0.83, -1.36], [0.83, -1.36]];
  // Segment counts are deliberately low. A filleted box at 10 segments is 1200
  // triangles, and with traffic on every road in the grid there are eighty-odd
  // cars on screen - they were costing more than the entire city put together.
  // At 3-4 segments the fillet still catches a highlight, which is all a car
  // seen at speed from behind actually needs.
  const tyreGeo = new THREE.TorusGeometry(0.24, 0.10, 6, 12);
  const rimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.17, 10);
  const archGeo = roundedBox(0.30, 0.46, 0.78, 0.16, 2);
  const headGeo = roundedBox(0.40, 0.15, 0.10, 0.05, 2);

  CAR_PARTS = {
    // Lower sill, main body and roof all take the paint.
    paint: bake([
      [roundedBox(1.76, 0.34, 3.94, 0.12, 3), at(0, 0.5, 0)],
      [roundedBox(1.72, 0.60, 4.12, 0.26, 4), at(0, 0.78, 0)],
      [roundedBox(1.34, 0.16, 1.55, 0.12, 3), at(0, 1.46, -0.22)],
    ]),
    glass: bake([[roundedBox(1.56, 0.50, 2.05, 0.30, 4), at(0, 1.24, -0.16)]]),
    dark: bake([
      ...wheels.map(([dx, dz]) => [archGeo, at(dx * 0.98, 0.56, dz)] as [THREE.BufferGeometry, THREE.Matrix4]),
      ...[2.03, -2.03].map((dz) =>
        [roundedBox(1.70, 0.22, 0.20, 0.09, 3), at(0, 0.56, dz)] as [THREE.BufferGeometry, THREE.Matrix4]),
    ]),
    tyre: bake(wheels.map(([dx, dz]) =>
      [tyreGeo, at(dx, 0.34, dz, 0, Math.PI / 2, 0)] as [THREE.BufferGeometry, THREE.Matrix4])),
    rim: bake(wheels.map(([dx, dz]) =>
      [rimGeo, at(dx, 0.34, dz, 0, 0, Math.PI / 2)] as [THREE.BufferGeometry, THREE.Matrix4])),
    head: bake([-0.56, 0.56].map((dx) =>
      [headGeo, at(dx, 0.86, 2.06)] as [THREE.BufferGeometry, THREE.Matrix4])),
    tail: bake([-0.56, 0.56].map((dx) =>
      [headGeo, at(dx, 0.88, -2.06)] as [THREE.BufferGeometry, THREE.Matrix4])),
  };

  tyreGeo.dispose();
  rimGeo.dispose();
  archGeo.dispose();
  headGeo.dispose();
  return CAR_PARTS;
}

/** Half the car's length and width, for collision boxes. Front is +Z. */
export const CAR_HALF = { x: 0.95, z: 2.15 };

export function makeCar(color: number): THREE.Group {
  const parts = carParts();
  let paint = CAR_PAINT.get(color);
  if (!paint) {
    paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.5 });
    CAR_PAINT.set(color, paint);
  }

  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    g.add(m);
  };
  add(parts.paint, paint);
  add(parts.glass, SHARED.glassCool);
  add(parts.dark, CAR_DARK);
  add(parts.tyre, SHARED.tyre);
  add(parts.rim, SHARED.chrome);
  add(parts.head, CAR_HEAD, false);
  add(parts.tail, CAR_TAIL, false);
  return g;
}

/** Kept for the cars sitting against the kerb. Same model, it just isn't moving. */
export function makeParkedCar(color: number): THREE.Group {
  return makeCar(color);
}

export const CAR_COLORS = [0xd8453f, 0xf0f0f0, 0x2c3e6b, 0x2f7a4a, 0x1a1a1e, 0xd8a021];

const LIGHT_RED = new THREE.MeshStandardMaterial({
  color: 0xff2a3a, emissive: 0xff2a3a, emissiveIntensity: 1.4, roughness: 0.3,
});
const LIGHT_BLUE = new THREE.MeshStandardMaterial({
  color: 0x2a6cff, emissive: 0x2a6cff, emissiveIntensity: 1.4, roughness: 0.3,
});
const LIGHT_AMBER = new THREE.MeshStandardMaterial({
  color: 0xffa422, emissive: 0xffa422, emissiveIntensity: 1.4, roughness: 0.3,
});
const LIGHT_WHITE = new THREE.MeshStandardMaterial({
  color: 0xfff4e0, emissive: 0xfff4e0, emissiveIntensity: 1.4, roughness: 0.3,
});

/**
 * A patrol car: the white body with a light bar on the roof.
 *
 * The two halves of the bar are returned so the chase can flash them - a
 * stationary police car and one that is coming for you have to read differently
 * from a long way off, and at minimap distance the flash is the only cue.
 */
export function makePoliceCar(riot = false): { group: THREE.Group; lights: [THREE.Mesh, THREE.Mesh] } {
  // Riot units are a different vehicle entirely at a glance: matte black
  // instead of white, amber running lights, a bull bar and a cage on the roof.
  // The player has to be able to tell which kind is coming from a long way off,
  // because the answer changes whether running is worth trying.
  const group = makeCar(riot ? 0x15171c : 0xf2f4f7);

  const barGeo = roundedBox(0.34, 0.13, 0.5, 0.05, 2);
  const red = new THREE.Mesh(barGeo, riot ? LIGHT_AMBER : LIGHT_RED);
  red.position.set(-0.2, 1.62, -0.1);
  const blue = new THREE.Mesh(barGeo, riot ? LIGHT_WHITE : LIGHT_BLUE);
  blue.position.set(0.2, 1.62, -0.1);
  const spine = new THREE.Mesh(
    roundedBox(0.9, 0.09, 0.42, 0.04, 2),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6 }),
  );
  spine.position.set(0, 1.57, -0.1);
  group.add(spine, red, blue);

  const trim = new THREE.MeshStandardMaterial({
    color: riot ? 0x3a3d46 : 0x14161c, roughness: 0.7,
  });
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(roundedBox(0.04, 0.3, 2.6, 0.02, 2), trim);
    stripe.position.set(side * 0.88, 0.78, 0);
    group.add(stripe);
  }

  if (riot) {
    // Push bar across the nose.
    const bar = new THREE.Mesh(roundedBox(1.6, 0.5, 0.14, 0.06, 2), trim);
    bar.position.set(0, 0.62, 2.16);
    group.add(bar);
    for (const dx of [-0.5, 0.5]) {
      const post = new THREE.Mesh(roundedBox(0.12, 0.62, 0.12, 0.04, 2), trim);
      post.position.set(dx, 0.66, 2.1);
      group.add(post);
    }
    // Mesh over the windows, so the cabin reads as caged rather than glazed.
    for (const side of [-1, 1]) {
      const cage = new THREE.Mesh(roundedBox(0.05, 0.42, 1.9, 0.02, 2), trim);
      cage.position.set(side * 0.79, 1.24, -0.16);
      group.add(cage);
    }
    const roofRack = new THREE.Mesh(roundedBox(1.2, 0.08, 1.3, 0.04, 2), trim);
    roofRack.position.set(0, 1.55, -0.9);
    group.add(roofRack);
  }

  return { group, lights: [red, blue] };
}



/**
 * A roadside hoarding: the board, a frame, two legs and a light bar.
 *
 * Faced on both sides so it reads coming and going - a billboard you can only
 * see from one direction looks like a mistake from the other.
 */
export function makeBillboard(art: THREE.Texture, width = 7.5): THREE.Group {
  const g = new THREE.Group();
  const h = width * 0.5;
  const faceMat = new THREE.MeshStandardMaterial({ map: art, roughness: 0.82 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.7, metalness: 0.4 });

  const board = new THREE.Mesh(roundedBox(width, h, 0.18, 0.05, 4), frameMat);
  board.position.y = h / 2;
  board.castShadow = true;
  board.receiveShadow = true;
  g.add(board);

  for (const side of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.93, h * 0.86), faceMat);
    face.position.set(0, h / 2, side * 0.1);
    if (side < 0) face.rotation.y = Math.PI;
    g.add(face);
  }

  // Legs.
  for (const dx of [-width * 0.3, width * 0.3]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.0, 10), frameMat);
    leg.position.set(dx, -1.5, 0);
    leg.castShadow = true;
    g.add(leg);
  }

  // Lamp gantry along the bottom edge, angled up at the artwork.
  const gantry = new THREE.Mesh(roundedBox(width * 0.8, 0.09, 0.09, 0.03, 4), frameMat);
  gantry.position.set(0, 0.08, 0.42);
  g.add(gantry);
  for (const dx of [-width * 0.26, 0, width * 0.26]) {
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.13, 0.16, 10),
      new THREE.MeshStandardMaterial({
        color: 0xfff2cf, emissive: 0xffe9b0, emissiveIntensity: 0.5, roughness: 0.4,
      }),
    );
    lamp.rotation.x = -0.9;
    lamp.position.set(dx, 0.14, 0.42);
    g.add(lamp);
  }

  return g;
}

/**
 * A four-track with somebody on it.
 *
 * Cuatrimotos on the road are a real part of how the island rides, and Justin
 * asked for them in the traffic. Built as one group so Traffic can drop it in
 * wherever a car would go - it obeys the same lane, the same box, the same
 * everything, it just looks like a different Sunday.
 */
export function makeATV(color: number): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2127, roughness: 0.75 });

  const body = new THREE.Mesh(roundedBox(1.02, 0.42, 1.55, 0.14, 6), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);

  // Front rack and a snout.
  const rack = new THREE.Mesh(roundedBox(0.78, 0.07, 0.42, 0.04, 4), dark);
  rack.position.set(0, 0.86, 0.62);
  g.add(rack);
  const nose = new THREE.Mesh(roundedBox(0.82, 0.26, 0.36, 0.10, 5), paint);
  nose.position.set(0, 0.70, 0.80);
  g.add(nose);

  // Seat and bars.
  const seat = new THREE.Mesh(roundedBox(0.42, 0.16, 0.72, 0.07, 5), dark);
  seat.position.set(0, 0.92, -0.10);
  g.add(seat);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 8), dark);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.10, 0.42);
  g.add(bar);

  // Fat balloon tyres, which are most of an ATV's silhouette.
  for (const [dx, dz] of [[-0.52, 0.55], [0.52, 0.55], [-0.52, -0.55], [0.52, -0.55]] as const) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.135, 6, 12), SHARED.tyre);
    tyre.rotation.y = Math.PI / 2;
    tyre.position.set(dx, 0.30, dz);
    tyre.castShadow = true;
    g.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.20, 10), SHARED.chrome);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(dx, 0.30, dz);
    g.add(hub);
  }

  g.add(makeStandingRider(0, 1.02, -0.06, 0.9));
  return g;
}

/**
 * A bomba - the fire truck that comes for a wrecked patrol.
 *
 * Long red box with a ladder on top and a beacon, which is all a fire engine
 * needs to be from a moving bike. The beacon is returned so it can flash on the
 * way to a call.
 */
export function makeFireTruck(): { group: THREE.Group; beacon: THREE.Mesh } {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xc62128, roughness: 0.4, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.35, metalness: 0.85 });

  const body = new THREE.Mesh(roundedBox(2.10, 1.30, 5.40, 0.10, 3), red);
  body.position.y = 1.30;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const cab = new THREE.Mesh(roundedBox(2.00, 0.86, 1.70, 0.09, 3), red);
  cab.position.set(0, 2.10, 1.75);
  cab.castShadow = true;
  g.add(cab);
  const screen = new THREE.Mesh(roundedBox(1.84, 0.60, 0.10, 0.04, 3),
    new THREE.MeshStandardMaterial({
      color: 0x1a2029, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.88,
    }));
  screen.position.set(0, 2.16, 2.58);
  g.add(screen);

  // Ladder along the roof.
  for (const dx of [-0.32, 0.32]) {
    const rail = new THREE.Mesh(roundedBox(0.08, 0.08, 4.20, 0.03, 3), metal);
    rail.position.set(dx, 2.06, -0.60);
    g.add(rail);
  }
  for (let i = 0; i < 9; i++) {
    const rung = new THREE.Mesh(roundedBox(0.72, 0.05, 0.05, 0.02, 3), metal);
    rung.position.set(0, 2.06, -2.40 + i * 0.45);
    g.add(rung);
  }

  // Lockers down the flanks, which is what a pump looks like side-on.
  for (const side of [-1, 1]) {
    for (const dz of [-1.5, -0.2, 1.1]) {
      const locker = new THREE.Mesh(roundedBox(0.06, 0.70, 1.05, 0.03, 3), trim);
      locker.position.set(side * 1.06, 1.28, dz);
      g.add(locker);
    }
  }

  for (const [dx, dz] of [[-0.92, 1.80], [0.92, 1.80], [-0.92, -1.70], [0.92, -1.70]] as const) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.16, 6, 12), SHARED.tyre);
    tyre.rotation.y = Math.PI / 2;
    tyre.position.set(dx, 0.46, dz);
    tyre.castShadow = true;
    g.add(tyre);
  }

  const beacon = new THREE.Mesh(
    roundedBox(0.70, 0.14, 0.24, 0.05, 3),
    new THREE.MeshStandardMaterial({
      color: 0xff2a3a, emissive: 0xff2a3a, emissiveIntensity: 1.4, roughness: 0.3,
    }),
  );
  beacon.position.set(0, 2.60, 1.70);
  g.add(beacon);

  return { group: g, beacon };
}

/**
 * A chuma - a Vespa-shaped scooter with somebody on it.
 *
 * Step-through frame, a legshield up front, the body swelling behind the seat,
 * and small wheels. That silhouette is the whole read at any distance you see
 * one from, so it is four shapes and no more.
 */
export function makeScooter(color: number): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.7 });

  // Legshield: the tall panel between the rider's knees and the front wheel.
  const shield = new THREE.Mesh(roundedBox(0.44, 0.62, 0.16, 0.10, 6), paint);
  shield.position.set(0, 0.66, 0.52);
  shield.rotation.x = -0.14;
  shield.castShadow = true;
  g.add(shield);

  // Floorpan you step through.
  const floor = new THREE.Mesh(roundedBox(0.40, 0.09, 0.52, 0.04, 4), dark);
  floor.position.set(0, 0.36, 0.16);
  g.add(floor);

  // The body swells behind the seat - the bit that makes it a Vespa.
  const haunch = new THREE.Mesh(roundedBox(0.50, 0.42, 0.62, 0.18, 8), paint);
  haunch.position.set(0, 0.60, -0.28);
  haunch.castShadow = true;
  g.add(haunch);

  const seat = new THREE.Mesh(roundedBox(0.30, 0.11, 0.48, 0.05, 5), dark);
  seat.position.set(0, 0.86, -0.16);
  g.add(seat);

  // Bars and a round headlight on the shield.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.56, 8), dark);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.02, 0.56);
  g.add(bar);
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.085, 0.05, 12),
    new THREE.MeshStandardMaterial({
      color: 0xf6f2e2, emissive: 0x3a3830, emissiveIntensity: 0.4, roughness: 0.2,
    }),
  );
  lamp.rotation.x = Math.PI / 2 - 0.14;
  lamp.position.set(0, 0.90, 0.60);
  g.add(lamp);

  // Small wheels, which is the other half of the silhouette.
  for (const dz of [0.52, -0.44]) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.07, 6, 12), SHARED.tyre);
    tyre.rotation.y = Math.PI / 2;
    tyre.position.set(0, 0.22, dz);
    tyre.castShadow = true;
    g.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.10, 10), SHARED.chrome);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(0, 0.22, dz);
    g.add(rim);
  }

  const rider = makePerson(0xe8e4d8, 0x36404f, true);
  rider.position.set(0, 0.40, -0.14);
  rider.scale.setScalar(0.92);
  g.add(rider);
  return g;
}

/**
 * The ICE unit: a big black wagon rather than a patrol car.
 *
 * It has to be recognisable at the far end of a street, because seeing one
 * changes whether running is worth trying. Squarer, taller and half again as
 * long as a police car, with a push bar and a roof rack.
 */
export function makeHummer(): { group: THREE.Group; lights: [THREE.Mesh, THREE.Mesh] } {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.42, metalness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2f3239, roughness: 0.65, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x14181e, roughness: 0.12, metalness: 0.5, transparent: true, opacity: 0.88,
  });

  // Slab sides, flat roof, no curves worth speaking of.
  const hull = new THREE.Mesh(roundedBox(2.06, 0.86, 4.70, 0.10, 3), body);
  hull.position.y = 0.98;
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);
  const cab = new THREE.Mesh(roundedBox(1.92, 0.66, 2.60, 0.09, 3), glass);
  cab.position.set(0, 1.62, -0.28);
  cab.castShadow = true;
  g.add(cab);
  const roof = new THREE.Mesh(roundedBox(1.84, 0.14, 2.50, 0.06, 3), body);
  roof.position.set(0, 1.96, -0.28);
  g.add(roof);

  // Bonnet, squared off flat.
  const bonnet = new THREE.Mesh(roundedBox(1.94, 0.30, 1.30, 0.07, 3), body);
  bonnet.position.set(0, 1.52, 1.42);
  g.add(bonnet);
  const grille = new THREE.Mesh(roundedBox(1.60, 0.40, 0.14, 0.04, 3), trim);
  grille.position.set(0, 1.42, 2.06);
  g.add(grille);

  // Push bar across the front, and a rack on the roof.
  const bar = new THREE.Mesh(roundedBox(1.86, 0.60, 0.16, 0.05, 3), trim);
  bar.position.set(0, 1.00, 2.32);
  g.add(bar);
  for (const dx of [-0.62, 0.62]) {
    const post = new THREE.Mesh(roundedBox(0.14, 0.80, 0.14, 0.04, 3), trim);
    post.position.set(dx, 1.10, 2.26);
    g.add(post);
  }
  const rack = new THREE.Mesh(roundedBox(1.70, 0.10, 1.90, 0.04, 3), trim);
  rack.position.set(0, 2.08, -0.40);
  g.add(rack);

  // Tall square-shouldered tyres.
  for (const [dx, dz] of [[-0.92, 1.52], [0.92, 1.52], [-0.92, -1.52], [0.92, -1.52]] as const) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.17, 6, 12), SHARED.tyre);
    tyre.rotation.y = Math.PI / 2;
    tyre.position.set(dx, 0.48, dz);
    tyre.castShadow = true;
    g.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.26, 8), trim);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(dx, 0.48, dz);
    g.add(hub);
    const arch = new THREE.Mesh(roundedBox(0.30, 0.50, 1.00, 0.10, 3), trim);
    arch.position.set(dx * 0.98, 0.76, dz);
    g.add(arch);
  }

  // Concealed strobes behind the screen rather than a light bar.
  const stripGeo = roundedBox(0.40, 0.10, 0.06, 0.02, 2);
  const red = new THREE.Mesh(stripGeo, new THREE.MeshStandardMaterial({
    color: 0xff2a3a, emissive: 0xff2a3a, emissiveIntensity: 1.2, roughness: 0.3,
  }));
  red.position.set(-0.44, 1.90, 0.92);
  const blue = new THREE.Mesh(stripGeo, new THREE.MeshStandardMaterial({
    color: 0x2a6cff, emissive: 0x2a6cff, emissiveIntensity: 1.2, roughness: 0.3,
  }));
  blue.position.set(0.44, 1.90, 0.92);
  g.add(red, blue);

  return { group: g, lights: [red, blue] };
}

/**
 * A person, at the fidelity a person seen from a moving bike deserves.
 *
 * Deliberately simple: capsules and a head. At any distance you actually see
 * one of these from, silhouette and colour are the whole of it, and a hundred
 * detailed pedestrians would cost more than the entire city.
 */
export function makePerson(shirt: number, trousers: number, seated = false): THREE.Group {
  return cached(`person:${shirt}:${trousers}:${seated}`, () => buildPerson(shirt, trousers, seated));
}

function buildPerson(shirt: number, trousers: number, seated = false): THREE.Group {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xa9713f, roughness: 0.85 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const legMat = new THREE.MeshStandardMaterial({ color: trousers, roughness: 0.9 });

  const legLen = seated ? 0.34 : 0.72;
  const hip = seated ? 0.46 : 0.82;

  // Deliberately coarse. A first pass at (6,10) capsules and a 12x10 head came
  // to ~2000 triangles a person and 125k across the city - two thirds of the
  // whole scene, for figures you pass at 30 mph. At this resolution they are a
  // few hundred each and read identically from a bike.
  for (const dx of [-0.09, 0.09]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, legLen, 3, 6), legMat);
    leg.position.set(dx, hip - legLen / 2 - 0.05, seated ? 0.12 : 0);
    if (seated) leg.rotation.x = Math.PI / 2.2;
    leg.castShadow = true;
    g.add(leg);
  }

  const torso = new THREE.Mesh(roundedBox(0.30, 0.46, 0.19, 0.08, 2), shirtMat);
  torso.position.set(0, hip + 0.23, 0);
  torso.castShadow = true;
  g.add(torso);

  for (const dx of [-0.19, 0.19]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.44, 3, 6), shirtMat);
    arm.position.set(dx, hip + 0.22, seated ? 0.06 : 0);
    if (seated) arm.rotation.x = -0.5;
    g.add(arm);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 8, 6), skinMat);
  head.position.set(0, hip + 0.58, 0);
  head.castShadow = true;
  g.add(head);

  return g;
}

/** Somebody sat on a machine - used on the ATV. */
function makeStandingRider(x: number, y: number, z: number, scale: number): THREE.Group {
  const p = makePerson(0xe8e4d8, 0x2f3b52, true);
  p.position.set(x, y - 0.46, z);
  p.scale.setScalar(scale);
  return p;
}

/**
 * A domino table with four viejos round it.
 *
 * The single most Puerto Rican thing that could be put in a plaza. Four chairs,
 * four players, a slab of tiles on the table - and they are all facing in,
 * because that is the point of the game.
 */
export function makeDominoTable(seed = 0): THREE.Group {
  const g = new THREE.Group();
  // Local rng: this file has no need of the shared one and a table only wants
  // its tiles scattered differently from the next table's.
  let n = (seed * 31 + 7) >>> 0;
  const rnd = () => {
    n = (n * 1664525 + 1013904223) >>> 0;
    return n / 4294967296;
  };
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.85 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.7 });

  const top = new THREE.Mesh(roundedBox(1.0, 0.06, 1.0, 0.03, 4), plastic);
  top.position.y = 0.74;
  top.castShadow = true;
  top.receiveShadow = true;
  g.add(top);
  for (const [dx, dz] of [[-0.42, 0.42], [0.42, 0.42], [-0.42, -0.42], [0.42, -0.42]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.74, 6), wood);
    leg.position.set(dx, 0.37, dz);
    g.add(leg);
  }

  // The tiles, face down in the middle - the shuffle before a hand.
  for (let i = 0; i < 14; i++) {
    const tile = new THREE.Mesh(roundedBox(0.05, 0.016, 0.095, 0.006, 3), plastic);
    tile.position.set((rnd() - 0.5) * 0.5, 0.782, (rnd() - 0.5) * 0.5);
    tile.rotation.y = rnd() * Math.PI;
    g.add(tile);
  }

  // Four players, mostly older, in the shirts you actually see on a plaza.
  const shirts = [0xf0ece0, 0x8fb7d8, 0xe0d08a, 0xcf8f7a];
  const trousers = [0x4a4f5a, 0x36404f, 0x5a5348, 0x2f3b52];
  const seats: Array<[number, number, number]> = [
    [0, -1.0, 0], [0, 1.0, Math.PI], [-1.0, 0, Math.PI / 2], [1.0, 0, -Math.PI / 2],
  ];
  seats.forEach(([sx, sz, ry], i) => {
    const chair = new THREE.Mesh(roundedBox(0.4, 0.06, 0.4, 0.02, 3), wood);
    chair.position.set(sx * 0.92, 0.45, sz * 0.92);
    g.add(chair);
    const back = new THREE.Mesh(roundedBox(0.4, 0.42, 0.05, 0.02, 3), wood);
    back.position.set(sx * 1.1, 0.68, sz * 1.1);
    back.rotation.y = ry;
    g.add(back);

    const person = makePerson(shirts[i], trousers[i], true);
    person.position.set(sx * 0.92, 0.0, sz * 0.92);
    person.rotation.y = ry + Math.PI;
    g.add(person);
  });

  return g;
}

/** The garita - the domed sentry box on the fort walls. Pure PR silhouette. */
export function makeGarita(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 3.0, 10), SHARED.stone);
  body.position.y = 1.5;
  body.castShadow = true;
  g.add(body);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    SHARED.stone,
  );
  dome.position.y = 3.0;
  dome.castShadow = true;
  g.add(dome);
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 8), SHARED.stone);
  finial.position.y = 4.35;
  g.add(finial);
  // Slit windows
  const slit = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.2), slit);
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.18, 2.1, Math.sin(a) * 1.18);
    s.rotation.y = -a + Math.PI / 2;
    g.add(s);
  }
  g.scale.setScalar(scale);
  return g;
}

/** El Morro on the headland, read at distance as a long sandstone rampart. */
export function makeFort(): THREE.Group {
  const g = new THREE.Group();
  const tiers = [
    { w: 120, h: 9, d: 34, y: 0 },
    { w: 96, h: 8, d: 26, y: 9 },
    { w: 62, h: 8, d: 20, y: 17 },
  ];
  for (const t of tiers) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), SHARED.stone);
    m.position.y = t.y + t.h / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  for (const [x, z, y] of [
    [-56, 15, 9], [56, 15, 9], [-44, -15, 9], [44, -15, 9], [0, 9, 25],
  ]) {
    const gar = makeGarita(1.6);
    gar.position.set(x, y, z);
    g.add(gar);
  }
  // Lighthouse on top
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 11, 12), SHARED.stone);
  tower.position.set(-14, 30, 0);
  g.add(tower);
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 2.4, 12),
    new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.3, metalness: 0.5 }),
  );
  lamp.position.set(-14, 36.5, 0);
  g.add(lamp);
  return g;
}

export function makeAwning(width: number, color: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const m = new THREE.Mesh(roundedBox(width, 0.11, 1.5, 0.045, 6), mat);
  m.rotation.x = -0.32;
  m.castShadow = true;
  return m;
}

/**
 * Shop signs, cached by what they say.
 *
 * Each sign paints its own canvas, and three.js uploads every distinct Texture
 * separately - so once the city grew to a few hundred buildings this alone was
 * a hundred GPU textures for what is really a couple of dozen distinct signs.
 * That is the same fault that ran the Xbox out of memory once already.
 */
const SIGN_MATS = new Map<string, THREE.MeshStandardMaterial>();

export function makeShopSign(text: string, bg: string, fg: string, width = 2.6): THREE.Mesh {
  const key = `${text}|${bg}|${fg}`;
  let mat = SIGN_MATS.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ map: makeSignTexture(text, bg, fg), roughness: 0.8 });
    SIGN_MATS.set(key, mat);
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.25), mat);
}

export const PROP_MATERIALS = SHARED;

/**
 * Somebody else out riding.
 *
 * Not the player's bike. BikeView builds a fully articulated machine with a
 * jointed rider on it, which is right for the one you are sat on and far too
 * much for four more of them down the street - so this is a silhouette: the
 * stance, the paint and the wheelie, at about a twentieth of the cost.
 *
 * Built with the REAR CONTACT PATCH at the local origin and +Z forward, exactly
 * like BikeView, so `pitch.rotation.x = -angle` lofts the front wheel about the
 * point it actually pivots on.
 *
 * Three materials for the whole rider and bike - paint, dark, and kit - so the
 * frame bakes down to three meshes plus a wheel each end. The rider is in full
 * moto-X gear including a lid, which is both what people actually wear here and
 * the reason no skin material is needed.
 */
export interface RivalLook {
  /** Silhouette family, shared with the player's bikes. */
  style: 'dirt' | 'mini' | 'sport';
  bodyColor: number;
  /** Helmet and jersey. */
  kitColor: number;
  frontRadius: number;
  rearRadius: number;
  hipHeight: number;
  seatZ: number;
}

export interface RivalModel {
  group: THREE.Group;
  /** Rotate about X to loft the front wheel. */
  pitch: THREE.Group;
  /** Rotate about Z to lean. */
  roll: THREE.Group;
  front: THREE.Mesh;
  rear: THREE.Mesh;
}

/** Wheelbase by family (m), off the real bikes. */
const RIVAL_WHEELBASE = { dirt: 1.475, mini: 1.200, sport: 1.488 } as const;

export function makeRivalBike(look: RivalLook): RivalModel {
  const key = `rival:${look.style}:${look.bodyColor}:${look.kitColor}`;
  const proto = cached(key, () => buildRival(look));
  const group = proto.clone(true);
  // clone() preserves names, which is how the moving parts are found again.
  return {
    group,
    pitch: group.getObjectByName('pitch') as THREE.Group,
    roll: group.getObjectByName('roll') as THREE.Group,
    front: group.getObjectByName('front') as THREE.Mesh,
    rear: group.getObjectByName('rear') as THREE.Mesh,
  };
}

function buildRival(look: RivalLook): THREE.Group {
  const root = new THREE.Group();
  const roll = new THREE.Group();
  roll.name = 'roll';
  const pitch = new THREE.Group();
  pitch.name = 'pitch';
  root.add(roll);
  roll.add(pitch);

  const paint = new THREE.MeshStandardMaterial({
    color: look.bodyColor, roughness: 0.38, metalness: 0.28,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.62 });
  const kit = new THREE.MeshStandardMaterial({ color: look.kitColor, roughness: 0.72 });

  const wb = RIVAL_WHEELBASE[look.style];
  const fr = look.frontRadius;
  const rr = look.rearRadius;
  const seatY = look.hipHeight - 0.10;
  const sport = look.style === 'sport';

  // ---- frame, in a scratch group that gets baked flat ---------------------
  const body = new THREE.Group();
  const add = (
    geo: THREE.BufferGeometry, mat: THREE.Material,
    x: number, y: number, z: number, rx = 0,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    body.add(m);
  };

  // Engine and swingarm: the mass low down, which is most of the read from
  // behind.
  add(roundedBox(0.30, 0.34, 0.44, 0.07, 2), dark, 0, rr + 0.16, wb * 0.42);
  for (const dx of [-0.11, 0.11]) {
    add(roundedBox(0.05, 0.09, wb * 0.44, 0.02, 1), dark, dx, rr + 0.05, wb * 0.20, -0.07);
  }
  // Exhaust down the right side, which is where it is on all three of them.
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.52, 7), dark,
    sport ? 0 : 0.14, rr + (sport ? -0.05 : 0.30), sport ? 0.10 : 0.04, Math.PI / 2 - 0.12);

  // Tank and bodywork.
  add(roundedBox(0.28, 0.26, 0.58, 0.10, 2), paint, 0, seatY + 0.10, look.seatZ + 0.42);
  // A dirt bike wears shrouds either side of the tank; a sportbike wears a
  // fairing that is one shape. Same triangles, different silhouette.
  if (sport) {
    add(roundedBox(0.34, 0.30, 0.40, 0.12, 2), paint, 0, seatY + 0.06, wb - 0.22);
  } else {
    for (const dx of [-0.16, 0.16]) {
      add(roundedBox(0.05, 0.24, 0.44, 0.03, 1), paint, dx, seatY + 0.06, look.seatZ + 0.50);
    }
  }
  // Seat and tail.
  add(roundedBox(0.24, 0.09, 0.56, 0.04, 2), dark, 0, seatY, look.seatZ + 0.02);
  add(roundedBox(0.22, 0.14, 0.30, 0.06, 2), paint, 0, seatY + 0.06, look.seatZ - 0.34);

  // Forks up to the bars, raked back.
  const rake = sport ? 0.42 : 0.48;
  const forkLen = look.hipHeight - fr + 0.24;
  for (const dx of [-0.12, 0.12]) {
    add(new THREE.CylinderGeometry(0.032, 0.038, forkLen, 6), dark,
      dx, fr + forkLen * 0.46, wb - forkLen * 0.22 * Math.sin(rake), rake);
  }
  const barY = fr + forkLen * 0.92;
  const barZ = wb - forkLen * 0.44 * Math.sin(rake);
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.66, 6), dark);
  bars.rotation.z = Math.PI / 2;
  bars.position.set(0, barY, barZ);
  body.add(bars);
  // Front fender on the dirt bikes, a headlight nacelle on the street ones.
  add(sport ? roundedBox(0.22, 0.16, 0.20, 0.07, 2) : roundedBox(0.24, 0.05, 0.46, 0.02, 1),
    paint, 0, sport ? barY - 0.10 : fr + 0.30, sport ? barZ + 0.16 : wb - 0.06);

  // Number plate on the tail. Body-coloured rather than pale, because a fourth
  // material here is a fourth draw call on every rival in the scene, and a
  // race plate is usually the team colour anyway.
  add(roundedBox(0.20, 0.16, 0.03, 0.01, 1), paint, 0, seatY - 0.02, look.seatZ - 0.50);

  // ---- rider, in full gear ------------------------------------------------
  // Cranked forward on a sportbike, sat up on a dirt bike, which is the single
  // clearest tell of what somebody is riding.
  const lean = sport ? 0.40 : 0.16;
  const hipZ = look.seatZ + 0.04;
  const hipY = look.hipHeight;
  const chest = 0.36;
  const chestY = hipY + Math.cos(lean) * chest;
  const chestZ = hipZ + Math.sin(lean) * chest;

  // Rotation about X by a POSITIVE angle tips the top of a part toward +Z,
  // which is forward - so leaning onto the tank is +lean. Negating it, which is
  // what the first pass did, sat every rider back off the bars like a deck
  // chair, and on the Ducati that is 23 degrees the wrong way.
  add(roundedBox(0.32, 0.46, 0.23, 0.10, 2), kit,
    0, (hipY + chestY) / 2, (hipZ + chestZ) / 2, lean);
  // Shoulder yoke. A jersey and a roost deflector are wider across the top than
  // the chest, and without it the torso reads as a fridge.
  add(roundedBox(0.40, 0.13, 0.24, 0.06, 2), kit,
    0, chestY - 0.06, chestZ - Math.sin(lean) * 0.04, lean);
  // Thighs down to the pegs, shins tucked under.
  for (const dx of [-0.12, 0.12]) {
    add(new THREE.CapsuleGeometry(0.075, 0.30, 2, 6), dark,
      dx, hipY - 0.12, hipZ + 0.16, Math.PI / 2.4);
    add(new THREE.CapsuleGeometry(0.065, 0.26, 2, 6), dark,
      dx * 1.15, hipY - 0.36, hipZ + 0.08, 0.25);
  }
  // Arms out to the bars. One capsule each: at this size an elbow is a lie
  // nobody can see.
  for (const dx of [-0.17, 0.17]) {
    const sx = dx;
    const sy = chestY - 0.04;
    const sz = chestZ;
    const ex = dx * 1.6;
    const ey = barY + 0.03;
    const ez = barZ - 0.04;
    const len = Math.hypot(ex - sx, ey - sy, ez - sz);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, Math.max(0.05, len - 0.11), 2, 6), kit);
    arm.position.set((sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2);
    arm.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(ex - sx, ey - sy, ez - sz).normalize(),
    );
    body.add(arm);
  }

  // Moto-X lid: shell, chin bar, peak.
  //
  // Painted to match the BIKE rather than the jersey. That is how a kit is
  // actually put together, and it is doing real work here: a helmet the same
  // colour as the shirt merged into one solid blob at any distance, which is
  // what the first pass looked like from behind. It also costs nothing - the
  // paint material is already in the bake.
  const headY = chestY + 0.26;
  const headZ = chestZ + Math.sin(lean) * 0.20;
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 9, 7), paint);
  shell.position.set(0, headY, headZ);
  body.add(shell);
  add(roundedBox(0.20, 0.13, 0.14, 0.05, 2), paint, 0, headY - 0.06, headZ + 0.12, lean);
  const peak = new THREE.Mesh(roundedBox(0.25, 0.025, 0.21, 0.012, 1), paint);
  peak.position.set(0, headY + 0.09, headZ + 0.17);
  peak.rotation.x = 0.34;
  body.add(peak);
  // Visor slot, dark, so the lid has a front - and a neck under it, so the head
  // is a separate thing from the shoulders.
  add(roundedBox(0.17, 0.07, 0.03, 0.01, 1), dark, 0, headY + 0.005, headZ + 0.135);
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.10, 6), dark,
    0, headY - 0.145, headZ - Math.sin(lean) * 0.04);

  // Bake the lot down: three meshes, whatever the part count above grows to.
  for (const baked of bakeSubtree(body)) pitch.add(baked);

  // ---- wheels, which are the only things left moving ----------------------
  const front = rivalWheel(fr, sport ? 0.13 : 0.115, dark);
  front.name = 'front';
  front.position.set(0, fr, wb);
  pitch.add(front);
  const rear = rivalWheel(rr, sport ? 0.20 : 0.145, dark);
  rear.name = 'rear';
  rear.position.set(0, rr, 0);
  pitch.add(rear);

  return root;
}

/**
 * One mesh, one material, one draw call per wheel.
 *
 * The player's wheels are laced and knobbled by Wheel.ts because they are a
 * metre from the camera. These are seen from across a junction, where a tyre
 * and a hint of a hub is the whole of it.
 */
function rivalWheel(radius: number, width: number, mat: THREE.Material): THREE.Mesh {
  const parts: THREE.Mesh[] = [];
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius - width * 0.34, width * 0.34, 5, 12), mat);
  tyre.rotation.y = Math.PI / 2;
  parts.push(tyre);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, width * 0.5, 10), mat);
  hub.rotation.z = Math.PI / 2;
  parts.push(hub);
  // Three arms, so a stationary wheel still reads as stopped and a turning one
  // as turning.
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Mesh(roundedBox(0.02, radius * 1.5, width * 0.42, 0.008, 1), mat);
    arm.rotation.z = (i / 3) * Math.PI;
    parts.push(arm);
  }
  const wheel = mergeMeshes(parts, mat);
  wheel.castShadow = true;
  return wheel;
}
