import * as THREE from 'three';
import { makePalmFrondTexture, makeSignTexture } from './textures';

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
  const segs = 7;
  const lean = (rnd(1) - 0.5) * 0.5;
  let y = 0;
  for (let i = 0; i < segs; i++) {
    const h = height / segs;
    const r0 = 0.19 - (i / segs) * 0.09;
    const r1 = 0.19 - ((i + 1) / segs) * 0.09;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 8), SHARED.trunk);
    const t = i / segs;
    seg.position.set(lean * t * t * height * 0.25, y + h / 2, 0);
    seg.rotation.z = -lean * t * 0.25;
    seg.castShadow = true;
    g.add(seg);
    y += h;
  }

  const topX = lean * height * 0.25;
  const frondMat = new THREE.MeshStandardMaterial({
    map: getFrondTexture(),
    transparent: true,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  const frondGeo = new THREE.PlaneGeometry(3.4, 3.4);
  const count = 8;
  for (let i = 0; i < count; i++) {
    const f = new THREE.Mesh(frondGeo, frondMat);
    const a = (i / count) * Math.PI * 2 + rnd(i) * 0.3;
    f.position.set(topX + Math.cos(a) * 1.35, y + 0.15 - rnd(i + 3) * 0.35, Math.sin(a) * 1.35);
    f.rotation.set(-Math.PI / 2 + 0.35 + rnd(i + 7) * 0.35, 0, 0);
    f.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -a);
    f.castShadow = true;
    g.add(f);
  }

  // Coconuts
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), SHARED.trunk);
    const a = (i / 3) * Math.PI * 2;
    c.position.set(topX + Math.cos(a) * 0.32, y - 0.2, Math.sin(a) * 0.32);
    g.add(c);
  }
  return g;
}

/** Colonial cast-iron street lamp, the ones all over Old San Juan. */
export function makeStreetLamp(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.26, 0.5, 10), SHARED.iron);
  base.position.y = 0.25;
  g.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 10), SHARED.iron);
  post.position.y = 2.3;
  post.castShadow = true;
  g.add(post);
  const arm = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.045, 6, 12, Math.PI / 2), SHARED.iron);
  arm.position.set(0, 4.1, 0);
  arm.rotation.set(Math.PI / 2, 0, Math.PI);
  g.add(arm);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.24, 0.55, 4), SHARED.glassWarm);
  lantern.position.set(0.45, 3.95, 0);
  g.add(lantern);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.22, 4), SHARED.iron);
  cap.position.set(0.45, 4.3, 0);
  g.add(cap);
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

/** A parked car. No traffic in the prototype - these are obstacles and scenery. */
export function makeParkedCar(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.75, 4.3),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.35 }),
  );
  body.position.y = 0.72;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.62, 2.1), SHARED.glassCool);
  cabin.position.set(0, 1.36, -0.2);
  cabin.castShadow = true;
  g.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12);
  for (const [dx, dz] of [[-0.86, 1.4], [0.86, 1.4], [-0.86, -1.4], [0.86, -1.4]]) {
    const w = new THREE.Mesh(wheelGeo, SHARED.tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(dx, 0.33, dz);
    g.add(w);
  }
  const lightGeo = new THREE.BoxGeometry(0.42, 0.16, 0.08);
  for (const dx of [-0.6, 0.6]) {
    const l = new THREE.Mesh(lightGeo, SHARED.chrome);
    l.position.set(dx, 0.85, 2.16);
    g.add(l);
  }
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
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, 1.5), mat);
  m.rotation.x = -0.32;
  m.castShadow = true;
  return m;
}

export function makeShopSign(text: string, bg: string, fg: string, width = 2.6): THREE.Mesh {
  const tex = makeSignTexture(text, bg, fg);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.25), mat);
}

export const PROP_MATERIALS = SHARED;
