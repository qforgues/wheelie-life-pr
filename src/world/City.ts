import * as THREE from 'three';
import type { CrashReason, GroundProvider, GroundSample } from '../sim/types';
import type { SpawnPoint } from '../sim/BikeSim';
import {
  makeAwning, makeFort, makeGarita, makeParkedCar, makePalm, makePlanter,
  makeShopSign, makeStreetLamp, PROP_MATERIALS,
} from './Props';
import { makeCobbleTexture, makeFacadeTexture, makeFlagMuralTexture, makeSidewalkTexture } from './textures';

/**
 * A single slice of an Old San Juan-ish barrio: one long cobbled avenue running
 * north to the sea, two cross streets, and a plaza overlook with the fort on the
 * headland beyond.
 *
 * The avenue is the point. It is 490 m of straight, with two clean 130 m+
 * stretches so there is somewhere to actually hold a wheelie and rack up
 * distance. Speed bumps are placed to give you something to pop off.
 */

export const LAYOUT = {
  roadHalf: 6,
  sidewalk: 2.3,
  avenueStart: -60,
  avenueEnd: 430,
  blockDepth: 14,
  crossStreets: [
    { z: 80, half: 8, xMin: -95, xMax: 95 },
    { z: 256, half: 8, xMin: -95, xMax: 95 },
  ],
  plaza: { zMin: 398, zMax: 456, xMin: -42, xMax: 42 },
  seaWallZ: 456,
} as const;

interface Box2 { minX: number; maxX: number; minZ: number; maxZ: number; }
interface Bump { z: number; strength: number; }

export class City implements GroundProvider {
  readonly root = new THREE.Group();
  readonly spawn: SpawnPoint = { x: 0, z: LAYOUT.avenueStart + 25, yaw: 0 };

  private colliders: Box2[] = [];
  private bumps: Bump[] = [];
  private lastZ = 0;
  private primed = false;

  constructor() {
    this.buildRoads();
    this.buildBlocks();
    this.buildPlaza();
    this.buildHeadland();
    this.buildBounds();
  }

  // ---------------------------------------------------------------- terrain

  private buildRoads(): void {
    const cobble = makeCobbleTexture();
    const walk = makeSidewalkTexture();

    const avenueLen = LAYOUT.avenueEnd - LAYOUT.avenueStart;
    const avenueMid = (LAYOUT.avenueEnd + LAYOUT.avenueStart) / 2;

    const roadMat = new THREE.MeshStandardMaterial({ map: cobble, roughness: 0.96 });
    cobble.repeat.set((LAYOUT.roadHalf * 2) / 3.5, avenueLen / 3.5);

    const avenue = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.roadHalf * 2, avenueLen), roadMat);
    avenue.rotation.x = -Math.PI / 2;
    avenue.position.set(0, 0, avenueMid);
    avenue.receiveShadow = true;
    this.root.add(avenue);

    // Cross streets, sharing the same cobble but with their own repeat.
    for (const cs of LAYOUT.crossStreets) {
      const tex = cobble.clone();
      tex.needsUpdate = true;
      tex.repeat.set((cs.xMax - cs.xMin) / 3.5, (cs.half * 2) / 3.5);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(cs.xMax - cs.xMin, cs.half * 2),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set((cs.xMin + cs.xMax) / 2, 0.001, cs.z);
      m.receiveShadow = true;
      this.root.add(m);
    }

    // Sidewalks + kerbs down both sides of the avenue.
    const walkMat = new THREE.MeshStandardMaterial({ map: walk, roughness: 0.95 });
    walk.repeat.set(LAYOUT.sidewalk / 1.5, avenueLen / 1.5);
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(
        new THREE.BoxGeometry(LAYOUT.sidewalk, 0.16, avenueLen),
        walkMat,
      );
      sw.position.set(side * (LAYOUT.roadHalf + LAYOUT.sidewalk / 2), 0.08, avenueMid);
      sw.receiveShadow = true;
      this.root.add(sw);
    }

    // Speed bumps: free lift if you time the pull.
    for (const z of [30, 190, 330]) {
      this.bumps.push({ z, strength: 1.25 });
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(LAYOUT.roadHalf * 2, 0.13, 0.9),
        new THREE.MeshStandardMaterial({ color: 0xd8c23a, roughness: 0.85 }),
      );
      b.position.set(0, 0.06, z);
      b.receiveShadow = true;
      b.castShadow = true;
      this.root.add(b);
    }
  }

  // --------------------------------------------------------------- buildings

  private buildBlocks(): void {
    const facades = Array.from({ length: 12 }, (_, i) => makeFacadeTexture(i * 977 + 13, 3, 3));
    let seed = 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const gaps: Array<[number, number]> = [
      ...LAYOUT.crossStreets.map((c) => [c.z - c.half - 2, c.z + c.half + 2] as [number, number]),
      [LAYOUT.plaza.zMin - 4, LAYOUT.plaza.zMax],
    ];
    const inGap = (a: number, b: number) => gaps.some(([g0, g1]) => b > g0 && a < g1);

    for (const side of [-1, 1]) {
      let z = LAYOUT.avenueStart;
      let index = 0;
      while (z < LAYOUT.avenueEnd) {
        const width = 11 + rnd() * 7;
        if (inGap(z, z + width)) { z += 2; continue; }
        const height = 7.5 + rnd() * 6;
        const facade = facades[Math.floor(rnd() * facades.length)];
        this.addBuilding(side, z, width, height, facade, rnd, index++);
        z += width + 0.35;
      }
    }

    // Buildings framing the cross streets so they don't dead-end into nothing.
    for (const cs of LAYOUT.crossStreets) {
      for (const zSide of [-1, 1]) {
        for (const dir of [-1, 1]) {
          let x = LAYOUT.roadHalf + 20;
          while (x < 92) {
            const w = 12 + rnd() * 6;
            const h = 7 + rnd() * 5;
            const facade = facades[Math.floor(rnd() * facades.length)];
            const cz = cs.z + zSide * (cs.half + LAYOUT.blockDepth / 2 + 1.5);
            this.addBoxBuilding(
              dir * (x + w / 2), cz, w, LAYOUT.blockDepth, h, facade, zSide > 0 ? 5 : 4, rnd,
            );
            x += w + 0.4;
          }
        }
      }
    }
  }

  private addBuilding(
    side: number, z: number, width: number, height: number,
    facade: THREE.Texture, rnd: () => number, index: number,
  ): void {
    const depth = LAYOUT.blockDepth;
    const x = side * (LAYOUT.roadHalf + LAYOUT.sidewalk + depth / 2);
    // Street-facing material index: +X face (0) for the left row, -X face (1) for the right.
    const faceIndex = side < 0 ? 0 : 1;
    const mesh = this.addBoxBuilding(x, z + width / 2, depth, width, height, facade, faceIndex, rnd);

    // Real balcony geometry on the first floor - the drawn ones on the texture
    // do the detail, these do the shadow.
    if (rnd() > 0.35) {
      const bx = side * (LAYOUT.roadHalf + LAYOUT.sidewalk - 0.35);
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.14, Math.min(3.4, width * 0.45)),
        PROP_MATERIALS.stone,
      );
      slab.position.set(bx, height * 0.42, z + width / 2);
      slab.castShadow = true;
      this.root.add(slab);
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.85, Math.min(3.4, width * 0.45)),
        PROP_MATERIALS.iron,
      );
      rail.position.set(bx - side * 0.46, height * 0.42 + 0.5, z + width / 2);
      rail.castShadow = true;
      this.root.add(rail);
    }

    // Ground-floor colmado / taller every few buildings.
    if (index % 4 === 1) {
      const names = ['COLMADO', 'TALLER', 'PANADERÍA', 'FRITURAS', 'PIRAGUA', 'BARBERÍA'];
      const bg = ['#1f6b52', '#8c3a2e', '#2f5d7c', '#d8a021'];
      const sign = makeShopSign(
        names[index % names.length], bg[index % bg.length], '#fbf6e9', 3.0,
      );
      sign.position.set(
        side * (LAYOUT.roadHalf + LAYOUT.sidewalk - 0.05), 3.5, z + width / 2,
      );
      sign.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.root.add(sign);

      const awn = makeAwning(Math.min(3.6, width * 0.5), [0xd8453f, 0x2f7ab0, 0xe0a13a][index % 3]);
      awn.position.set(side * (LAYOUT.roadHalf + LAYOUT.sidewalk - 0.7), 2.85, z + width / 2);
      awn.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      awn.rotation.z = side < 0 ? -0.32 : 0.32;
      this.root.add(awn);
    }

    // Street furniture on the pavement in front.
    const px = side * (LAYOUT.roadHalf + LAYOUT.sidewalk * 0.55);
    const roll = rnd();
    if (roll > 0.78) {
      const lamp = makeStreetLamp();
      lamp.position.set(px, 0.16, z + width / 2);
      lamp.rotation.y = side < 0 ? 0 : Math.PI;
      this.root.add(lamp);
    } else if (roll > 0.62) {
      const palm = makePalm(6 + rnd() * 3.5, index * 7 + side);
      palm.position.set(px, 0.16, z + width / 2);
      this.root.add(palm);
    } else if (roll > 0.5) {
      const p = makePlanter(index);
      p.position.set(px, 0.16, z + width / 2);
      this.root.add(p);
    }

    // A handful of cars parked against the kerb - obstacles, not traffic.
    if (rnd() > 0.84 && width > 13) {
      const colors = [0xd8453f, 0xf0f0f0, 0x2c3e6b, 0x2f7a4a, 0x1a1a1e, 0xd8a021];
      const car = makeParkedCar(colors[Math.floor(rnd() * colors.length)]);
      const cx = side * (LAYOUT.roadHalf - 1.05);
      car.position.set(cx, 0, z + width / 2);
      this.root.add(car);
      this.colliders.push({
        minX: cx - 1.0, maxX: cx + 1.0, minZ: z + width / 2 - 2.2, maxZ: z + width / 2 + 2.2,
      });
    }

    void mesh;
  }

  private addBoxBuilding(
    x: number, z: number, sizeX: number, sizeZ: number, height: number,
    facade: THREE.Texture, faceIndex: number, rnd: () => number,
  ): THREE.Mesh {
    // Every wall gets a facade, not just the one facing the street: the ends of
    // the blocks are fully visible from the cross streets and the plaza, and
    // blank slabs there were killing the whole look.
    const wall = (faceWidth: number, bright: number) => {
      const tex = facade.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(faceWidth / 10)), Math.max(1, Math.round(height / 9)));
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.94,
        color: new THREE.Color(bright, bright, bright),
      });
    };

    // Side walls are very slightly knocked back so the frontage still reads as
    // the "face" of the building.
    const xFaces = wall(sizeZ, faceIndex <= 1 ? 1 : 0.88);
    const zFaces = wall(sizeX, faceIndex >= 4 ? 1 : 0.88);
    const roof = new THREE.MeshStandardMaterial({ color: 0x8f7358, roughness: 0.98 });

    const mats: THREE.Material[] = [xFaces, xFaces, roof, roof, zFaces, zFaces];
    void rnd;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeX, height, sizeZ), mats);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);

    // Parapet so the rooflines aren't razor flat against the sky.
    const parapet = new THREE.Mesh(
      new THREE.BoxGeometry(sizeX + 0.35, 0.55, sizeZ + 0.35),
      new THREE.MeshStandardMaterial({ color: 0xe0d6c0, roughness: 0.96 }),
    );
    parapet.position.set(x, height + 0.2, z);
    parapet.castShadow = true;
    this.root.add(parapet);

    // A water tank or two up top, so the skyline has some silhouette.
    if (sizeX > 12 && sizeZ > 12) {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 1.1, 10),
        new THREE.MeshStandardMaterial({ color: 0x2f4a6b, roughness: 0.8 }),
      );
      tank.position.set(x + sizeX * 0.22, height + 0.95, z - sizeZ * 0.2);
      tank.castShadow = true;
      this.root.add(tank);
    }

    this.colliders.push({
      minX: x - sizeX / 2, maxX: x + sizeX / 2, minZ: z - sizeZ / 2, maxZ: z + sizeZ / 2,
    });
    return mesh;
  }

  // ------------------------------------------------------------------ plaza

  private buildPlaza(): void {
    const p = LAYOUT.plaza;
    const walk = makeSidewalkTexture();
    walk.repeat.set((p.xMax - p.xMin) / 3, (p.zMax - p.zMin) / 3);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(p.xMax - p.xMin, p.zMax - p.zMin),
      new THREE.MeshStandardMaterial({ map: walk, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((p.xMin + p.xMax) / 2, 0.002, (p.zMin + p.zMax) / 2);
    floor.receiveShadow = true;
    this.root.add(floor);

    // Sea wall along the top of the bluff.
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(p.xMax - p.xMin + 30, 1.15, 1.1),
      PROP_MATERIALS.stone,
    );
    wall.position.set(0, 0.58, LAYOUT.seaWallZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.root.add(wall);
    this.colliders.push({
      minX: -200, maxX: 200, minZ: LAYOUT.seaWallZ - 0.7, maxZ: LAYOUT.seaWallZ + 30,
    });

    // The bluff dropping away to the water.
    const bluff = new THREE.Mesh(
      new THREE.BoxGeometry(420, 26, 40),
      new THREE.MeshStandardMaterial({ color: 0x9a8a6e, roughness: 1 }),
    );
    bluff.position.set(0, -13.2, LAYOUT.seaWallZ + 19);
    bluff.receiveShadow = true;
    this.root.add(bluff);

    for (const x of [-24, 24]) {
      const palm = makePalm(9.5, x);
      palm.position.set(x, 0.02, p.zMax - 7);
      this.root.add(palm);
      const g = makeGarita(0.9);
      g.position.set(x * 1.5, 0.02, LAYOUT.seaWallZ - 1.6);
      this.root.add(g);
    }

    // The flag mural, on the wall of the last building before the plaza.
    const mural = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 6.9),
      new THREE.MeshStandardMaterial({ map: makeFlagMuralTexture(), roughness: 0.95 }),
    );
    mural.position.set(LAYOUT.roadHalf + LAYOUT.sidewalk - 0.06, 3.9, p.zMin - 12);
    mural.rotation.y = -Math.PI / 2;
    this.root.add(mural);

    // The road sign from the cover: Vieques, Isla Grande, Toda la Isla.
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 4.6, 8), PROP_MATERIALS.iron,
    );
    post.position.set(-13, 2.3, p.zMin + 6);
    this.root.add(post);
    const rows: Array<[string, number]> = [['VIEQUES', 4.0], ['ISLA GRANDE', 3.35], ['TODA LA ISLA', 2.7]];
    for (const [text, y] of rows) {
      const s = makeShopSign(text, '#1f6b52', '#ffffff', 3.4);
      s.position.set(-13 + 1.75, y, p.zMin + 6);
      s.rotation.y = Math.PI;
      this.root.add(s);
    }
  }

  private buildHeadland(): void {
    const fort = makeFort();
    fort.position.set(-210, 4, 860);
    fort.rotation.y = 0.22;
    this.root.add(fort);

    const headland = new THREE.Mesh(
      new THREE.BoxGeometry(420, 12, 190),
      new THREE.MeshStandardMaterial({ color: 0x5f7a44, roughness: 1 }),
    );
    headland.position.set(-210, -2, 860);
    this.root.add(headland);

    // A second, smaller island out on the water for depth.
    const isle = new THREE.Mesh(
      new THREE.BoxGeometry(260, 9, 90),
      new THREE.MeshStandardMaterial({ color: 0x6a8450, roughness: 1 }),
    );
    isle.position.set(320, -3, 1120);
    this.root.add(isle);
  }

  /** Invisible walls so you can't ride out of the slice into the void. */
  private buildBounds(): void {
    this.colliders.push({ minX: -400, maxX: 400, minZ: LAYOUT.avenueStart - 12, maxZ: LAYOUT.avenueStart - 8 });
    this.colliders.push({ minX: -104, maxX: -96, minZ: -400, maxZ: 900 });
    this.colliders.push({ minX: 96, maxX: 104, minZ: -400, maxZ: 900 });
  }

  // -------------------------------------------------------- GroundProvider

  sample(x: number, z: number, speed: number, _dt: number): GroundSample {
    let bumpKick = 0;
    if (this.primed && Math.abs(x) < LAYOUT.roadHalf + 1) {
      for (const b of this.bumps) {
        const crossed = (this.lastZ - b.z) * (z - b.z) <= 0 && this.lastZ !== z;
        if (crossed) {
          // A bump only kicks if you're actually moving; scaled so it's a nudge
          // at walking pace and a real launch at speed.
          bumpKick = b.strength * Math.min(1, Math.abs(speed) / 14) * Math.sign(speed || 1);
        }
      }
    }
    this.lastZ = z;
    this.primed = true;

    const onPavement = Math.abs(x) > LAYOUT.roadHalf && Math.abs(x) < LAYOUT.roadHalf + LAYOUT.sidewalk;
    return {
      height: onPavement ? 0.16 : 0,
      friction: onPavement ? 0.88 : 1.0,
      bumpKick,
    };
  }

  collide(x: number, z: number, _speed: number): CrashReason | null {
    const r = 0.42;
    for (const b of this.colliders) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) {
        return 'impact';
      }
    }
    return null;
  }

  /**
   * Nearest sane place to drop the player back in, facing up the avenue and
   * already rolling in 2nd - which is the gear you want to be in to lift.
   */
  respawnFor(x: number, z: number): SpawnPoint {
    // Forget where the bike was, or the teleport can read as a bump crossing.
    this.primed = false;
    const rolling = { speed: 11, gear: 1 };
    const p = LAYOUT.plaza;
    if (z > p.zMin - 20) {
      return { x: 0, z: p.zMin - 70, yaw: 0, ...rolling };
    }
    for (const cs of LAYOUT.crossStreets) {
      if (Math.abs(x) > LAYOUT.roadHalf && Math.abs(z - cs.z) < cs.half + 6) {
        return {
          x: Math.sign(x) * Math.min(Math.abs(x), 70),
          z: cs.z,
          yaw: x > 0 ? -Math.PI / 2 : Math.PI / 2,
          ...rolling,
        };
      }
    }
    const back = Math.max(LAYOUT.avenueStart + 12, z - 24);
    return { x: 0, z: back, yaw: 0, ...rolling };
  }
}
