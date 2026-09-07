import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makePalmFrondTexture, makeSignTexture } from './textures';
import { mergeMeshes, roundedBox } from '../view/geometry';

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

export function makePalm(height = 7, seed = 0): THREE.Group {
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

/**
 * A patrol car: the white body with a light bar on the roof.
 *
 * The two halves of the bar are returned so the chase can flash them - a
 * stationary police car and one that is coming for you have to read differently
 * from a long way off, and at minimap distance the flash is the only cue.
 */
export function makePoliceCar(): { group: THREE.Group; lights: [THREE.Mesh, THREE.Mesh] } {
  const group = makeCar(0xf2f4f7);

  const barGeo = roundedBox(0.34, 0.13, 0.5, 0.05, 2);
  const red = new THREE.Mesh(barGeo, LIGHT_RED);
  red.position.set(-0.2, 1.62, -0.1);
  const blue = new THREE.Mesh(barGeo, LIGHT_BLUE);
  blue.position.set(0.2, 1.62, -0.1);
  const spine = new THREE.Mesh(
    roundedBox(0.9, 0.09, 0.42, 0.04, 2),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.6 }),
  );
  spine.position.set(0, 1.57, -0.1);
  group.add(spine, red, blue);

  // A dark stripe down the flanks so it is not just a white car.
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(
      roundedBox(0.04, 0.3, 2.6, 0.02, 2),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7 }),
    );
    stripe.position.set(side * 0.88, 0.78, 0);
    group.add(stripe);
  }

  return { group, lights: [red, blue] };
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
