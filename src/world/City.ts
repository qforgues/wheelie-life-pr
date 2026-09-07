import * as THREE from 'three';
import { Traffic } from './Traffic';
import type { CrashReason, GroundProvider } from '../sim/types';
import type { SpawnPoint } from '../sim/BikeSim';
import { bakeSubtree, mergeMeshes, roundedBox, scaleUV } from '../view/geometry';
import { standard } from '../view/materials';
import {
  CAR_COLORS, makeAwning, makeBillboard, makeDominoTable, makeFort, makeGarita,
  makeParkedCar, makePalm, makePerson, makePlanter,
  makeRailing, makeShopSign, makeStreetLamp, PROP_MATERIALS,
} from './Props';
import {
  makeAbiertoBillboard, makeChainLinkTexture, makeCobbleTexture, makeFacadeTexture, makeGrassTexture, makePiratasBillboard, makeFlagMuralTexture, makeHazardTexture, makeSidewalkTexture,
} from './textures';

/**
 * A single slice of an Old San Juan-ish barrio: one long cobbled avenue running
 * north to the sea, two cross streets, and a plaza overlook with the fort on the
 * headland beyond.
 *
 * The avenue is the point. It is 490 m of straight, with two clean 130 m+
 * stretches so there is somewhere to actually hold a wheelie and rack up
 * distance. Speed bumps are placed to give you something to pop off.
 */

/**
 * The city is a grid.
 *
 * It used to be a single avenue with two side streets, which was the right
 * shape for proving the physics and the wrong shape for riding around in: every
 * run was the same straight line. Roads are now defined as two sets of
 * centrelines - avenues running north-south, cross streets running east-west -
 * and everything else in this file is derived from them. Adding a road anywhere
 * is a single number in one of these arrays.
 */
export const LAYOUT = {
  roadHalf: 6,
  sidewalk: 2.3,
  /** How deep a row of buildings sits back from the kerb. */
  blockDepth: 16,
  /** Avenues run along Z, at these X positions. */
  avenueX: [-240, -120, 0, 120, 240],
  /** Cross streets run along X, at these Z positions. */
  streetZ: [-40, 120, 280, 440, 600],
  /** Speed bumps, on every avenue at these Z. */
  bumpZ: [40, 200, 360, 520],
  plaza: { zMin: 620, zMax: 672, xMin: -26, xMax: 26 },
  seaWallZ: 672,
} as const;

/** Where the roads start and stop - the extent every road is drawn across. */
export const MAP = {
  xMin: LAYOUT.avenueX[0],
  xMax: LAYOUT.avenueX[LAYOUT.avenueX.length - 1],
  zMin: LAYOUT.streetZ[0],
  zMax: LAYOUT.streetZ[LAYOUT.streetZ.length - 1],
} as const;

/** Distance beyond the road edge before a point is off the tarmac, 0 if on it. */
function distanceOffRoad(x: number, z: number): number {
  let best = Infinity;
  for (const ax of LAYOUT.avenueX) {
    best = Math.min(best, Math.max(0, Math.abs(x - ax) - LAYOUT.roadHalf));
    if (best === 0) return 0;
  }
  for (const sz of LAYOUT.streetZ) {
    best = Math.min(best, Math.max(0, Math.abs(z - sz) - LAYOUT.roadHalf));
    if (best === 0) return 0;
  }
  return best;
}

/** Nearest value in a sorted-ish list, and how far away it was. */
function nearest(v: number, list: readonly number[]): { value: number; dist: number } {
  let value = list[0];
  let dist = Math.abs(v - value);
  for (const c of list) {
    const d = Math.abs(v - c);
    if (d < dist) { dist = d; value = c; }
  }
  return { value, dist };
}

/** Kerb height. The sidewalk is this far above the road. */
const KERB_HEIGHT = 0.16;

/** Side of a scenery cell, and how far away a cell stops being drawn. */
const CELL_SIZE = 60;
const CULL_RADIUS = 320;
/**
 * Width of an alley through a building row.
 *
 * Three bikes abreast with room to move: the bike collides at a 0.42 m radius,
 * so this is comfortably more than three of them side by side.
 */
const ALLEY_WIDTH = 6.5;
/** How far the grass runs past the outermost road before the fog takes over. */
const GROUND_APRON = 420;
/**
 * How far past the last road the edge of the map sits.
 *
 * The far side of the outermost building row, plus a little. The fence stands
 * on this line and the roads run out to meet it - a road that stopped at the
 * last junction and left the gate standing on its own in a field read as two
 * unrelated things rather than the end of the street.
 */
const EDGE = LAYOUT.roadHalf + LAYOUT.sidewalk + LAYOUT.blockDepth + 4;
/**
 * The fence round the edge of the map.
 *
 * 2.6 m of chain link with barbed wire on top, which is what actually stands
 * between a barrio and the empty lot behind it. Panels are one alpha-tested
 * quad each - the wire is in the texture, not in geometry - so the whole
 * two-and-a-half kilometres of it is a few hundred triangles.
 */
const FENCE_HEIGHT = 2.6;
/** Metres of fence per texture tile. */
const FENCE_TILE = 1.2;

interface Box2 { minX: number; maxX: number; minZ: number; maxZ: number; }
/** A "muerto" - the tall speed humps all over the island. Real geometry. */
interface Bump { x: number; z: number; half: number; height: number; }

export class City implements GroundProvider {
  readonly root = new THREE.Group();
  readonly spawn: SpawnPoint = { x: 0, z: MAP.zMin + 30, yaw: 0 };

  private colliders: Box2[] = [];

  /** The one sidewalk texture, shared by the streets and the plaza floor. */
  private sidewalkTex!: THREE.CanvasTexture;
  /** Wall materials keyed `facadeUuid:brightness`, shared across every block. */
  private wallMats = new Map<string, THREE.MeshStandardMaterial>();
  private roofMat = standard({ color: 0x8f7358, roughness: 0.98 });

  /**
   * Building shells, shared between every building of the same size.
   *
   * Each building used to own its geometry, which meant ~3400 unique buffers
   * for the city. Distance culling hides them but does **not** free them: once
   * a mesh has been drawn its buffers stay resident, so riding around uploaded
   * the whole city and the console ran out. Sizes are rounded to the nearest
   * step below and the shell reused, which collapses thousands of buffers into
   * dozens without changing how the street looks.
   */
  private shells = new Map<string, THREE.BufferGeometry>();

  private shell(sizeX: number, height: number, sizeZ: number): THREE.BufferGeometry {
    const key = `${sizeX}|${height}|${sizeZ}`;
    let geo = this.shells.get(key);
    if (!geo) {
      geo = roundedBox(sizeX, height, sizeZ, 0.09, 3);
      const rows = Math.max(1, Math.round(height / 9));
      const xBays = Math.max(1, Math.round(sizeZ / 10));
      const zBays = Math.max(1, Math.round(sizeX / 10));
      scaleUV(geo, xBays, rows, 0);
      scaleUV(geo, xBays, rows, 1);
      scaleUV(geo, zBays, rows, 4);
      scaleUV(geo, zBays, rows, 5);
      this.shells.set(key, geo);
    }
    return geo;
  }

  /** Cap and cornice shells, shared the same way. */
  private caps = new Map<string, THREE.BufferGeometry>();
  private capMat = standard({ color: 0xe0d6c0, roughness: 0.96 });

  private cap(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
    const key = `${w}|${h}|${d}|${r}`;
    let geo = this.caps.get(key);
    if (!geo) {
      geo = roundedBox(w, h, d, r, 3);
      this.caps.set(key, geo);
    }
    return geo;
  }

  /**
   * A plain slab: the same rounded box at one segment instead of three.
   *
   * `cap` subdivides each face nine times so the fillet shades smoothly, which
   * is right for a cornice you ride past at arm's length and 108 triangles for
   * a block of wall. The muralla is 2.5 km of blocks. At three segments it came
   * to 60,000 triangles - a third of what the whole city was drawing - for an
   * edge nobody will ever be close enough to see rounded.
   */
  private slab(w: number, h: number, d: number): THREE.BufferGeometry {
    const key = `slab|${w}|${h}|${d}`;
    let geo = this.caps.get(key);
    if (!geo) {
      geo = roundedBox(w, h, d, 0.06, 1);
      this.caps.set(key, geo);
    }
    return geo;
  }
  private bumps: Bump[] = [];
  /** One shared fence post, cloned a few hundred times. */
  private posts: THREE.CylinderGeometry | null = null;

  /**
   * Scenery bucketed into square cells.
   *
   * A city this size is far more geometry than the console browser can afford
   * to consider every frame. Everything static goes into the cell it stands in,
   * and cells beyond `CULL_RADIUS` are switched off wholesale - one visibility
   * flag instead of a per-object frustum test, and the fog hides the edge.
   */
  private cells: Array<{ group: THREE.Group; cx: number; cz: number }> = [];
  private cellIndex = new Map<string, THREE.Group>();
  /** How many cells the city ended up in. Read by the diagnostics panel. */
  cellCount = 0;

  /** Moving cars. Owned here so `collide` can see them without extra plumbing. */
  readonly traffic = new Traffic();

  /**
   * Extra moving obstacles the sim should treat as solid.
   *
   * The police live in Game, because chasing needs to know what the rider is
   * doing and the city has no business knowing about heat. But a patrol car is
   * still a car in the road, so it has to be solid the same way traffic is.
   */
  extraCollider: ((x: number, z: number, r: number) => boolean) | null = null;

  constructor() {
    this.buildRoads();
    this.buildBlocks();
    this.buildPlaza();
    this.buildGround();
    this.buildBillboards();
    this.buildHeadland();
    this.buildFence();
    // Last, so anything added above is included in the bake.
    this.flushBlocks();
    this.root.add(this.traffic.root);
  }

  // ---------------------------------------------------------------- terrain

  /** The cell a point belongs to, created on demand. */
  private cellAt(x: number, z: number): THREE.Group {
    const ix = Math.floor(x / CELL_SIZE);
    const iz = Math.floor(z / CELL_SIZE);
    const key = `${ix},${iz}`;
    let g = this.cellIndex.get(key);
    if (!g) {
      g = new THREE.Group();
      this.cellIndex.set(key, g);
      this.cells.push({
        group: g,
        cx: (ix + 0.5) * CELL_SIZE,
        cz: (iz + 0.5) * CELL_SIZE,
      });
      this.root.add(g);
    }
    return g;
  }

  /** Adds a positioned object to whichever cell it stands in. */
  private blockAdd(obj: THREE.Object3D): void {
    this.cellAt(obj.position.x, obj.position.z).add(obj);
  }

  /**
   * Bakes every cell down to one mesh per material.
   *
   * Nothing inside a cell ever moves, so there is no reason for a block of
   * buildings to be three hundred separate objects. Before this the city
   * submitted ~1000 draw calls for 186k triangles - about 187 triangles each,
   * which is nearly all overhead - and the frame cost barely moved between the
   * high and low tiers, because the bottleneck was walking and submitting the
   * objects rather than drawing them.
   *
   * Per cell rather than city-wide, so the bounding boxes stay small and
   * distance culling still does its job.
   */
  private flushBlocks(): void {
    for (const cell of this.cells) {
      const baked = bakeSubtree(cell.group);
      // Free the originals before swapping the merged meshes in.
      cell.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !baked.includes(m)) m.geometry.dispose();
      });
      cell.group.clear();
      for (const mesh of baked) cell.group.add(mesh);
    }
    this.cellCount = this.cells.length;
  }

  /**
   * Grass everywhere the roads are not.
   *
   * Off the road network there was simply nothing, so you looked straight
   * through the world at the sky dome - a pale blue void that reads as fog
   * until you ride into it.
   *
   * Laid as tiles that fill the gaps BETWEEN road corridors rather than one
   * sheet with holes in it: a single plane under the whole city would either
   * bury the roads or float above them, and cutting holes in a plane is a lot
   * of work to arrive at the same rectangles. Every tile shares one material
   * and they are merged into a single mesh, so the whole ground is one draw
   * call.
   */
  private buildGround(): void {
    const tex = makeGrassTexture();
    const mat = standard({ map: tex, roughness: 1 });
    const R = LAYOUT.roadHalf;

    // The bands between corridors, plus an apron running out past the edges so
    // there is no visible seam at the horizon.
    const bands = (lines: readonly number[], apron: number): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      const sorted = [...lines].sort((a, b) => a - b);
      out.push([sorted[0] - apron, sorted[0] - R]);
      for (let i = 0; i < sorted.length - 1; i++) out.push([sorted[i] + R, sorted[i + 1] - R]);
      out.push([sorted[sorted.length - 1] + R, sorted[sorted.length - 1] + apron]);
      return out;
    };

    const xBands = bands(LAYOUT.avenueX, GROUND_APRON);
    const zBands = bands(LAYOUT.streetZ, GROUND_APRON);

    const tiles: THREE.Mesh[] = [];
    for (const [x0, x1] of xBands) {
      for (const [z0, z1] of zBands) {
        const w = x1 - x0;
        const d = z1 - z0;
        if (w < 0.2 || d < 0.2) continue;
        // The plaza and the water have their own surfaces; do not lay grass
        // over the top of them.
        if (z0 >= LAYOUT.plaza.zMin - 8) continue;

        const geo = new THREE.PlaneGeometry(w, d);
        scaleUV(geo, w / 6, d / 6);
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        // Just under kerb height, which is what the physics calls "off road",
        // and low enough that the sidewalk slabs cover their own footprint.
        m.position.set((x0 + x1) / 2, KERB_HEIGHT - 0.012, (z0 + z1) / 2);
        tiles.push(m);
      }
    }
    // The road corridors are cut out of those bands in BOTH axes, everywhere -
    // including out in the apron, where the road has long since stopped. So
    // every avenue left a six-metre slot of nothing running from the last cross
    // street out to the horizon, and you saw the sky dome through the floor.
    // Standing at the south gate it read as a pale blue river down the middle
    // of the street. Fill the slots past each road's own ends.
    const tile = (x0: number, x1: number, z0: number, z1: number) => {
      const w = x1 - x0;
      const d = z1 - z0;
      if (w < 0.2 || d < 0.2 || z0 >= LAYOUT.plaza.zMin - 8) return;
      const geo = new THREE.PlaneGeometry(w, d);
      scaleUV(geo, w / 6, d / 6);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, KERB_HEIGHT - 0.012, (z0 + z1) / 2);
      tiles.push(m);
    };
    // Start each strip where the tarmac actually stops, which is out at the
    // fence, not at the last junction.
    for (const ax of LAYOUT.avenueX) {
      tile(ax - R, ax + R, MAP.zMin - GROUND_APRON, MAP.zMin - EDGE);
      tile(ax - R, ax + R, MAP.zMax + EDGE, MAP.zMax + GROUND_APRON);
    }
    for (const sz of LAYOUT.streetZ) {
      tile(MAP.xMin - GROUND_APRON, MAP.xMin - EDGE, sz - R, sz + R);
      tile(MAP.xMax + EDGE, MAP.xMax + GROUND_APRON, sz - R, sz + R);
    }

    if (tiles.length) {
      const ground = mergeMeshes(tiles, mat);
      ground.castShadow = false;
      ground.receiveShadow = true;
      this.root.add(ground);
    }
  }

  /**
   * Hoardings on the block corners.
   *
   * Placed on the outward face of a corner, angled to the road, so you ride
   * toward them rather than past them side-on. Set back beyond the buildings so
   * they never block a line you might be riding.
   */
  private buildBillboards(): void {
    const art = [makeAbiertoBillboard(), makePiratasBillboard()];
    // Where a board can actually be seen.
    //
    // These used to sit 33 m out on both axes, which is PAST the building rows
    // (they end 24 m out) and therefore deep in the empty middle of a block,
    // hidden behind the buildings from every road. Nobody ever saw one.
    //
    // Rows stop 25 m short of a junction, so the corner between roughly 8 m and
    // 25 m on both axes is open ground with a clear diagonal view of the
    // crossing. That is where a hoarding goes.
    const back = LAYOUT.roadHalf + LAYOUT.sidewalk + 7;
    let n = 0;
    let placed = 0;

    for (const ax of LAYOUT.avenueX) {
      for (const sz of LAYOUT.streetZ) {
        // Every other junction, alternating which board goes up and which
        // corner it stands on.
        //
        // `n++` post-increments, so indexing art[n % 2] AFTER the test always
        // landed on an odd n - and therefore always the same board. Only one of
        // the two designs was ever built. Count the boards placed instead.
        if ((n++ % 2) !== 0) continue;
        const k = placed++;
        const sx = (k % 2 === 0) ? 1 : -1;
        const sz2 = (k % 4 < 2) ? 1 : -1;
        const board = makeBillboard(art[k % art.length], 9);
        board.position.set(ax + sx * back, 4.0, sz + sz2 * back);
        // Square on to the junction it stands over: face back along the
        // diagonal toward the crossing.
        board.rotation.y = Math.atan2(-sx, -sz2);
        this.blockAdd(board);
      }
    }
  }

  private buildRoads(): void {
    const cobble = makeCobbleTexture();
    const walk = makeSidewalkTexture();
    this.sidewalkTex = walk;

    // One material for every stretch of tarmac in the city; the tile rate is
    // baked into each mesh's UVs rather than cloned onto its own texture.
    const roadMat = standard({ map: cobble, roughness: 0.96 });
    const walkMat = standard({ map: walk, roughness: 0.95 });

    // Roads run right out to the fence line, not just between the outermost
    // junctions, so every one of them ends at a gate.
    const lenZ = MAP.zMax - MAP.zMin + EDGE * 2;
    const lenX = MAP.xMax - MAP.xMin + EDGE * 2;
    const midZ = (MAP.zMax + MAP.zMin) / 2;
    const midX = (MAP.xMax + MAP.xMin) / 2;
    const W = LAYOUT.roadHalf * 2;

    const slab = (w: number, l: number, x: number, z: number, rot: boolean) => {
      const geo = new THREE.PlaneGeometry(w, l);
      scaleUV(geo, w / 3.5, l / 3.5);
      const m = new THREE.Mesh(geo, roadMat);
      m.rotation.x = -Math.PI / 2;
      if (rot) m.rotation.z = Math.PI / 2;
      m.position.set(x, 0, z);
      m.receiveShadow = true;
      this.root.add(m);
    };

    for (const ax of LAYOUT.avenueX) slab(W, lenZ, ax, midZ, false);
    // Cross streets sit a hair higher so the two surfaces never z-fight where
    // they overlap at a junction.
    for (const sz of LAYOUT.streetZ) {
      const geo = new THREE.PlaneGeometry(lenX, W);
      scaleUV(geo, lenX / 3.5, W / 3.5);
      const m = new THREE.Mesh(geo, roadMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(midX, 0.001, sz);
      m.receiveShadow = true;
      this.root.add(m);
    }

    // Sidewalks run between junctions, so they don't cut across the road at a
    // crossing. Merged per orientation - one draw call each, not two hundred.
    const walkSlabs: THREE.Mesh[] = [];
    const kerb = LAYOUT.roadHalf + LAYOUT.sidewalk / 2;
    for (const ax of LAYOUT.avenueX) {
      for (const [z0, z1] of this.spansBetween(LAYOUT.streetZ, MAP.zMin, MAP.zMax)) {
        for (const side of [-1, 1]) {
          const g = roundedBox(LAYOUT.sidewalk, KERB_HEIGHT, z1 - z0, 0.04, 2);
          scaleUV(g, LAYOUT.sidewalk / 1.5, (z1 - z0) / 1.5);
          const m = new THREE.Mesh(g, walkMat);
          m.position.set(ax + side * kerb, KERB_HEIGHT / 2, (z0 + z1) / 2);
          walkSlabs.push(m);
        }
      }
    }
    for (const sz of LAYOUT.streetZ) {
      for (const [x0, x1] of this.spansBetween(LAYOUT.avenueX, MAP.xMin, MAP.xMax)) {
        for (const side of [-1, 1]) {
          const g = roundedBox(x1 - x0, KERB_HEIGHT, LAYOUT.sidewalk, 0.04, 2);
          scaleUV(g, (x1 - x0) / 1.5, LAYOUT.sidewalk / 1.5);
          const m = new THREE.Mesh(g, walkMat);
          m.position.set((x0 + x1) / 2, KERB_HEIGHT / 2, sz + side * kerb);
          walkSlabs.push(m);
        }
      }
    }
    if (walkSlabs.length) this.root.add(mergeMeshes(walkSlabs, walkMat));

    // Muertos across every avenue, at the same Z so they read as a pattern.
    const hazard = makeHazardTexture();
    const bumpMeshes: THREE.Mesh[] = [];
    for (const ax of LAYOUT.avenueX) {
      for (const z of LAYOUT.bumpZ) {
        const bump: Bump = { x: ax, z, half: 0.62, height: 0.115 };
        this.bumps.push(bump);
        bumpMeshes.push(this.buildBumpMesh(bump, hazard));
      }
    }
    this.root.add(mergeMeshes(bumpMeshes, bumpMeshes[0].material as THREE.Material));
  }

  /**
   * The gaps between crossings along one axis, so kerbs stop at every junction
   * instead of running straight through it.
   */
  private spansBetween(
    crossings: readonly number[], from: number, to: number, clearance?: number,
  ): Array<[number, number]> {
    const edge = clearance ?? LAYOUT.roadHalf + LAYOUT.sidewalk;
    const spans: Array<[number, number]> = [];
    let cursor = from;
    for (const c of [...crossings].sort((a, b) => a - b)) {
      const gapStart = c - edge;
      if (gapStart - cursor > 1) spans.push([cursor, gapStart]);
      cursor = Math.max(cursor, c + edge);
    }
    if (to - cursor > 1) spans.push([cursor, to]);
    return spans;
  }

  /** Humped strip across the road, vertices displaced by `bumpProfile`. */
  private buildBumpMesh(bump: Bump, tex: THREE.Texture): THREE.Mesh {
    const segments = 20;
    const width = LAYOUT.roadHalf * 2;
    const geo = new THREE.PlaneGeometry(width, bump.half * 2, 1, segments);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // Plane is still in its own XY frame here; y maps to world z after the
      // rotation below.
      const along = pos.getY(i);
      pos.setZ(i, bumpProfile(along / bump.half) * bump.height);
    }
    geo.computeVertexNormals();
    const mat = standard({ map: tex, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.004, bump.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  // --------------------------------------------------------------- buildings

  /**
   * Fills the city with frontage.
   *
   * Every road gets a row of buildings down each side, broken at the junctions.
   * Rows are grouped into blocks and each block is merged down to one mesh per
   * material, which is what makes a city this size affordable: three hundred
   * buildings would otherwise be a thousand draw calls, and the console browser
   * has already proved it has no room for that. Merging per block rather than
   * city-wide keeps the bounding boxes small enough for frustum culling to
   * still do its job.
   */
  private buildBlocks(): void {
    // Six, not twelve.
    //
    // After the cell bake, a cell costs exactly one draw call per material it
    // contains - so every extra facade is another mesh in every block that uses
    // it. Twelve facades and a light/dark variant of each was 24 wall
    // materials, and dense corners were 31 meshes. Six reads no differently
    // down a street where the buildings are all different sizes anyway.
    const facades = Array.from({ length: 6 }, (_, i) => makeFacadeTexture(i * 1637 + 13, 3, 3));
    let seed = 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const setback = LAYOUT.roadHalf + LAYOUT.sidewalk + LAYOUT.blockDepth / 2;

    // Rows along the avenues (buildings face +/-X), then along the streets.
    // Rows must stop clear of the row running the other way, or the two meet
    // inside each other at every block corner - which is the buildings growing
    // through one another, and a pile of geometry drawn for nothing.
    const corner = LAYOUT.roadHalf + LAYOUT.sidewalk + LAYOUT.blockDepth + 0.6;
    for (const ax of LAYOUT.avenueX) {
      for (const [z0, z1] of this.spansBetween(LAYOUT.streetZ, MAP.zMin, MAP.zMax, corner)) {
        for (const side of [-1, 1]) {
          this.frontage(true, ax + side * setback, -side, z0, z1, facades, rnd);
        }
      }
    }
    for (const sz of LAYOUT.streetZ) {
      for (const [x0, x1] of this.spansBetween(LAYOUT.avenueX, MAP.xMin, MAP.xMax, corner)) {
        for (const side of [-1, 1]) {
          this.frontage(false, sz + side * setback, -side, x0, x1, facades, rnd);
        }
      }
    }

  }

  /**
   * One row of buildings down one side of one road.
   *
   * `alongZ` says which way the row runs; `facing` is the direction the fronts
   * look, so the street-facing wall is the one that gets the bright facade.
   */
  private frontage(
    alongZ: boolean, offset: number, facing: number,
    from: number, to: number, facades: THREE.Texture[], rnd: () => number,
  ): void {
    let cursor = from;
    let index = 0;
    while (to - cursor > 12) {
      // Rounded to a step so the geometry can be shared. The eye cannot tell
      // 18.3 m from 18 m across a street; the GPU very much can tell 300
      // buffers from 30.
      //
      // Quantising ROUNDS, so it can round up past the space actually left -
      // which pushed the last building of a row through the row running the
      // other way and produced the z-fighting on the walls. Leave the remainder
      // empty instead of overrunning it.
      const want = quantise(16 + rnd() * 12, 2);
      if (want > to - cursor) break;
      const width = want;
      const height = quantise(8 + rnd() * 7, 1.5);
      const facade = facades[Math.floor(rnd() * facades.length)];
      const centre = cursor + width / 2;

      const x = alongZ ? offset : centre;
      const z = alongZ ? centre : offset;
      const sizeX = alongZ ? LAYOUT.blockDepth : width;
      const sizeZ = alongZ ? width : LAYOUT.blockDepth;
      // Material index of the wall that faces the street: +X is 0, -X is 1,
      // +Z is 4, -Z is 5.
      const faceIndex = alongZ ? (facing > 0 ? 0 : 1) : (facing > 0 ? 4 : 5);

      this.addBoxBuilding(x, z, sizeX, sizeZ, height, facade, faceIndex, rnd);
      this.decorate(alongZ, offset, facing, centre, width, height, index++, rnd);

      // Every few buildings, leave a callejón wide enough for three bikes
      // abreast. It opens into the empty middle of the block, which makes the
      // grid something to explore rather than a set of corridors.
      const alley = index % 4 === 3 && to - cursor > width + ALLEY_WIDTH + 14;
      cursor += width + (alley ? ALLEY_WIDTH : 0.4);
    }
  }

  /** Balconies, signs, awnings and street furniture on one building's frontage. */
  private decorate(
    alongZ: boolean, offset: number, facing: number,
    centre: number, width: number, height: number, index: number, rnd: () => number,
  ): void {
    const kerbOffset = offset - facing * (LAYOUT.blockDepth / 2 + LAYOUT.sidewalk * 0.45);
    const at = (across: number, y: number, along: number): [number, number, number] =>
      alongZ ? [across, y, along] : [along, y, across];
    // Buildings run along Z when alongZ, so a frontage facing +X is rotated a
    // quarter turn from one facing +Z.
    const faceYaw = alongZ ? (facing > 0 ? Math.PI / 2 : -Math.PI / 2) : (facing > 0 ? 0 : Math.PI);

    if (rnd() > 0.45) {
      const wallFace = offset - facing * (LAYOUT.blockDepth / 2 - 0.35);
      const railLen = Math.round(Math.min(3.4, width * 0.45) * 2) / 2;
      const slab = new THREE.Mesh(
        this.cap(alongZ ? 1.0 : railLen, 0.14, alongZ ? railLen : 1.0, 0.05),
        PROP_MATERIALS.stone,
      );
      slab.position.set(...at(wallFace, height * 0.42, centre));
      slab.castShadow = true;
      this.blockAdd(slab);

      const rail = makeRailing(railLen, 0.8, 0.15);
      rail.rotation.y = alongZ ? Math.PI / 2 : 0;
      rail.position.set(...at(wallFace + facing * 0.46, height * 0.42 + 0.07, centre));
      this.blockAdd(rail);
    }

    // A colmado or taller every few buildings, with an awning over the door.
    if (index % 3 === 1) {
      const names = ['COLMADO', 'TALLER', 'PANADERÍA', 'FRITURAS', 'PIRAGUA', 'BARBERÍA'];
      const bg = ['#1f6b52', '#8c3a2e', '#2f5d7c', '#d8a021'];
      const face = offset - facing * (LAYOUT.blockDepth / 2 - 0.05);
      const sign = makeShopSign(names[index % names.length], bg[index % bg.length], '#fbf6e9', 3.0);
      sign.rotation.y = faceYaw;
      sign.position.set(...at(face, 3.5, centre));
      this.blockAdd(sign);

      const awn = makeAwning(Math.min(3.6, width * 0.5), [0xd8453f, 0x2f7ab0, 0xe0a13a][index % 3]);
      awn.rotation.y = faceYaw;
      awn.rotation.z = alongZ ? (facing > 0 ? 0.32 : -0.32) : 0.32;
      awn.position.set(...at(offset - facing * (LAYOUT.blockDepth / 2 - 0.7), 2.85, centre));
      this.blockAdd(awn);
    }

    // Street furniture out on the pavement.
    const roll = rnd();
    // Street furniture sits on the kerb - `kerbOffset` is the pavement edge, so
    // everything here faces the road by construction. Palms are the expensive
    // one: each cell holding a palm pays for its trunk and leaf materials, so
    // the count is kept deliberately lean.
    if (roll > 0.86) {
      const lamp = makeStreetLamp();
      lamp.rotation.y = faceYaw + Math.PI / 2;
      lamp.position.set(...at(kerbOffset, KERB_HEIGHT, centre));
      this.blockAdd(lamp);
    } else if (roll > 0.72) {
      const palm = makePalm(6 + rnd() * 3.5, index * 7 + centre);
      palm.position.set(...at(kerbOffset, KERB_HEIGHT, centre));
      this.blockAdd(palm);
    } else if (roll > 0.38) {
      const planter = makePlanter(index);
      planter.position.set(...at(kerbOffset, KERB_HEIGHT, centre));
      this.blockAdd(planter);
    }

    // Somebody on the pavement. Not many - a handful down a street reads as
    // lived-in, a crowd reads as a parade and costs a fortune to draw.
    if (rnd() > 0.72) {
      // Two shirts and one pair of trousers. Every extra colour is another
      // material, and after the cell bake a material is a draw call in every
      // block it appears in - five shirts cost 350 draw calls across the city.
      const shirts = [0xf0ece0, 0x8fb7d8];
      const trousers = [0x36404f];
      const person = makePerson(
        shirts[Math.floor(rnd() * shirts.length)],
        trousers[Math.floor(rnd() * trousers.length)],
      );
      const along = centre + (rnd() - 0.5) * width * 0.6;
      person.position.set(...at(kerbOffset + facing * 0.4, KERB_HEIGHT, along));
      person.rotation.y = rnd() * Math.PI * 2;
      this.blockAdd(person);
    }

    // Cars against the kerb - obstacles, not traffic.
    if (rnd() > 0.86 && width > 18) {
      const carAcross = offset - facing * (LAYOUT.blockDepth / 2 + LAYOUT.sidewalk + 1.05);
      const car = makeParkedCar(CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]);
      car.rotation.y = alongZ ? 0 : Math.PI / 2;
      const [cx, , cz] = at(carAcross, 0, centre);
      car.position.set(cx, 0, cz);
      this.blockAdd(car);
      const halfX = alongZ ? 1.0 : 2.2;
      const halfZ = alongZ ? 2.2 : 1.0;
      this.colliders.push({
        minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ,
      });
    }
  }

  private addBoxBuilding(
    x: number, z: number, sizeX: number, sizeZ: number, height: number,
    facade: THREE.Texture, faceIndex: number, rnd: () => number,
  ): THREE.Mesh {
    // Every wall gets a facade, not just the one facing the street: the ends of
    // the blocks are fully visible from the cross streets and the plaza, and
    // blank slabs there were killing the whole look.
    // One material per facade for the whole city.
    //
    // There used to be a second, slightly darker variant for the walls that do
    // not face the street. It doubled the wall materials to 24, and after the
    // cell bake that is a doubled mesh count in every block - a real frame cost
    // for a shading difference you cannot pick out from the road.
    const wall = () => {
      const key = facade.uuid;
      let mat = this.wallMats.get(key);
      if (!mat) {
        mat = standard({ map: facade, roughness: 0.94 });
        this.wallMats.set(key, mat);
      }
      return mat;
    };

    const xFaces = wall();
    const zFaces = xFaces;
    void faceIndex;
    const roof = this.roofMat;

    const mats: THREE.Material[] = [xFaces, xFaces, roof, roof, zFaces, zFaces];
    void rnd;

    // 3 segments is enough: with a 9 cm radius on a 12 m wall the fillet is a
    // single chamfer facet per corner, which is all a building needs - it
    // catches a highlight and stops the edge aliasing.
    // Groups 0/1 are the +X/-X walls (spanning sizeZ), 4/5 the +Z/-Z walls
    // (spanning sizeX); 2/3 are the roof and floor, which use a flat material.
    const mesh = new THREE.Mesh(this.shell(sizeX, height, sizeZ), mats);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.blockAdd(mesh);

    // Parapet so the rooflines aren't razor flat against the sky.
    const capMat = this.capMat;
    const parapet = new THREE.Mesh(
      this.cap(sizeX + 0.35, 0.55, sizeZ + 0.35, 0.10), capMat,
    );
    parapet.position.set(x, height + 0.2, z);
    parapet.castShadow = true;
    this.blockAdd(parapet);

    // A cornice band under the parapet gives the roofline some depth instead of
    // a single flat lip.
    const cornice = new THREE.Mesh(
      this.cap(sizeX + 0.55, 0.22, sizeZ + 0.55, 0.08), capMat,
    );
    cornice.position.set(x, height - 0.16, z);
    cornice.castShadow = true;
    this.blockAdd(cornice);

    // A water tank or two up top, so the skyline has some silhouette.
    if (sizeX > 12 && sizeZ > 12) {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 1.1, 10),
        standard({ color: 0x2f4a6b, roughness: 0.8 }),
      );
      tank.position.set(x + sizeX * 0.22, height + 0.95, z - sizeZ * 0.2);
      tank.castShadow = true;
      this.blockAdd(tank);
    }

    this.colliders.push({
      minX: x - sizeX / 2, maxX: x + sizeX / 2, minZ: z - sizeZ / 2, maxZ: z + sizeZ / 2,
    });
    return mesh;
  }

  // ------------------------------------------------------------------ plaza

  private buildPlaza(): void {
    const p = LAYOUT.plaza;
    // Reuses the sidewalk texture the streets already uploaded - a second
    // identical canvas would be a second GPU texture for no visible gain.
    const floorGeo = new THREE.PlaneGeometry(p.xMax - p.xMin, p.zMax - p.zMin);
    scaleUV(floorGeo, (p.xMax - p.xMin) / 2.5, (p.zMax - p.zMin) / 2.5);
    const floor = new THREE.Mesh(
      floorGeo,
      standard({
        map: this.sidewalkTex, roughness: 0.96, color: 0xcfc6b4,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((p.xMin + p.xMax) / 2, 0.002, (p.zMin + p.zMax) / 2);
    floor.receiveShadow = true;
    this.root.add(floor);

    // Sea wall along the top of the bluff, with the ironwork on top of it.
    const wall = new THREE.Mesh(
      roundedBox(p.xMax - p.xMin + 26, 1.0, 0.9, 0.08, 3),
      PROP_MATERIALS.stone,
    );
    wall.position.set(0, 0.5, LAYOUT.seaWallZ);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.root.add(wall);
    const seaRail = makeRailing(p.xMax - p.xMin + 26, 0.9, 0.22);
    seaRail.rotation.y = Math.PI / 2;
    seaRail.position.set(0, 1.0, LAYOUT.seaWallZ);
    this.root.add(seaRail);
    this.colliders.push({
      minX: -200, maxX: 200, minZ: LAYOUT.seaWallZ - 0.6, maxZ: LAYOUT.seaWallZ + 30,
    });

    // The bluff dropping away to the water. Kept narrow so the sea reads.
    const bluff = new THREE.Mesh(
      new THREE.BoxGeometry(420, 26, 16),
      standard({ color: 0x7d6f56, roughness: 1 }),
    );
    bluff.position.set(0, -13.1, LAYOUT.seaWallZ + 7.5);
    bluff.receiveShadow = true;
    this.root.add(bluff);

    // Palms, garitas and benches along the overlook.
    for (const x of [-20, 20]) {
      const palm = makePalm(9.5, x);
      palm.position.set(x, 0.02, p.zMax - 9);
      this.root.add(palm);
      const g = makeGarita(0.9);
      g.position.set(x * 1.55, 0.02, LAYOUT.seaWallZ - 1.5);
      this.root.add(g);
    }
    for (const x of [-10, 0, 10]) {
      const seat = new THREE.Mesh(roundedBox(1.8, 0.13, 0.5, 0.05, 5), PROP_MATERIALS.stone);
      seat.position.set(x, 0.46, LAYOUT.seaWallZ - 3.2);
      seat.castShadow = true;
      this.root.add(seat);
      for (const dx of [-0.7, 0.7]) {
        const leg = new THREE.Mesh(roundedBox(0.16, 0.46, 0.42, 0.05, 4), PROP_MATERIALS.stone);
        leg.position.set(x + dx, 0.23, LAYOUT.seaWallZ - 3.2);
        this.root.add(leg);
      }
    }

    // Dominoes under the palms. Four viejos to a table, and this is the most
    // Puerto Rican thing that could possibly be in a plaza.
    for (const [dx, dz, seed] of [[-14, -18, 3], [13, -22, 9], [-4, -30, 17]] as const) {
      const table = makeDominoTable(seed);
      table.position.set(dx, KERB_HEIGHT, p.zMax + dz);
      table.rotation.y = seed * 0.7;
      this.root.add(table);
    }

    // Flagpole. La monoestrellada over the water.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 11, 10), PROP_MATERIALS.chrome,
    );
    pole.position.set(-15, 5.5, p.zMax - 16);
    pole.castShadow = true;
    this.root.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 2.1),
      standard({
        map: makeFlagMuralTexture(), roughness: 0.9, side: THREE.DoubleSide,
      }),
    );
    flag.position.set(-13.3, 9.6, p.zMax - 16);
    this.root.add(flag);

    // The flag mural on the last wall before the plaza opens up.
    const mural = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 6.9),
      standard({ map: makeFlagMuralTexture(), roughness: 0.95 }),
    );
    mural.position.set(LAYOUT.roadHalf + LAYOUT.sidewalk - 0.06, 3.9, p.zMin - 14);
    mural.rotation.y = -Math.PI / 2;
    this.root.add(mural);

    // The road sign from the cover: Vieques, Isla Grande, Toda la Isla.
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 4.6, 8), PROP_MATERIALS.iron,
    );
    post.position.set(-11, 2.3, p.zMin + 5);
    this.root.add(post);
    const rows: Array<[string, number]> = [['VIEQUES', 4.0], ['ISLA GRANDE', 3.35], ['TODA LA ISLA', 2.7]];
    for (const [text, y] of rows) {
      const sign = makeShopSign(text, '#1f6b52', '#ffffff', 3.4);
      sign.position.set(-11 + 1.75, y, p.zMin + 5);
      sign.rotation.y = Math.PI;
      this.root.add(sign);
    }
  }

  private buildHeadland(): void {
    const fort = makeFort();
    fort.position.set(-165, 5, 690);
    fort.rotation.y = 0.3;
    fort.scale.setScalar(1.5);
    this.root.add(fort);

    const headland = new THREE.Mesh(
      new THREE.BoxGeometry(400, 14, 200),
      standard({ color: 0x64794a, roughness: 1 }),
    );
    headland.position.set(-190, -2, 700);
    this.root.add(headland);
    // Cliff face under the fort so the headland doesn't float on the water.
    const cliff = new THREE.Mesh(
      new THREE.BoxGeometry(400, 16, 26),
      standard({ color: 0x8a7a60, roughness: 1 }),
    );
    cliff.position.set(-190, -3, 600);
    this.root.add(cliff);

    // A second, smaller island out on the water for depth.
    const isle = new THREE.Mesh(
      new THREE.BoxGeometry(260, 9, 90),
      standard({ color: 0x6a8450, roughness: 1 }),
    );
    isle.position.set(320, -3, 1120);
    this.root.add(isle);
  }

  /**
   * The fence round the edge of the map, and the thing that stops you leaving.
   *
   * The boundary used to be five invisible boxes, and it leaked. You could ride
   * out of the plaza gap, round the ends of the sea wall, and then all the way
   * round the OUTSIDE of the city on ten hectares of blank grass, because the
   * side walls stopped four metres past the plaza opening and nothing closed
   * the flanks. A flood fill of the map found it in a second; riding to the
   * corner of the map would have found it eventually and much worse.
   *
   * Closing the leak with a taller invisible box would have fixed half of it
   * and left the other half, which is that the edge of the map read as nothing
   * at all - a field, and then a wall you cannot see. So the boundary is a
   * fence now: chain link, barbed wire on top, and a gate across every road
   * that runs into it. A street that ends at a locked gate is a place; a street
   * that ends at nothing is a bug.
   */
  private buildFence(): void {
    const x0 = MAP.xMin - EDGE, x1 = MAP.xMax + EDGE;
    const z0 = MAP.zMin - EDGE, z1 = MAP.zMax + EDGE;
    // The plaza keeps its opening to the sea. Wide enough to leave the garitas
    // and the palms on the inside of it.
    const gap = 34;

    // ---- what actually stops the bike -------------------------------------
    // Much thicker than the fence looks, so nothing tunnels through at speed.
    const T = 6;
    for (const w of [
      { minX: x0 - T, maxX: x1 + T, minZ: z0 - T, maxZ: z0 },
      { minX: x0 - T, maxX: x0, minZ: z0 - T, maxZ: z1 + T },
      { minX: x1, maxX: x1 + T, minZ: z0 - T, maxZ: z1 + T },
      { minX: x0 - T, maxX: -gap, minZ: z1, maxZ: z1 + T },
      { minX: gap, maxX: x1 + T, minZ: z1, maxZ: z1 + T },
      // The flanks of the plaza opening. Without these the gap was a way out
      // to the side the moment you were past the north line.
      { minX: -gap - T, maxX: -gap, minZ: z1, maxZ: LAYOUT.seaWallZ + T },
      { minX: gap, maxX: gap + T, minZ: z1, maxZ: LAYOUT.seaWallZ + T },
    ]) this.colliders.push(w);

    // ---- the fence --------------------------------------------------------
    const mesh = standard({
      map: makeChainLinkTexture(),
      transparent: false,
      // Alpha TEST, not blend: nothing to sort, and it can sit in front of the
      // whole city for free.
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.75,
      metalness: 0.35,
      color: 0xd8dde2,
    });
    this.fenceRun(true, x0, z0, z1, LAYOUT.streetZ, mesh);
    this.fenceRun(true, x1, z0, z1, LAYOUT.streetZ, mesh);
    this.fenceRun(false, z0, x0, x1, LAYOUT.avenueX, mesh);
    this.fenceRun(false, z1, x0, -gap, LAYOUT.avenueX, mesh);
    this.fenceRun(false, z1, gap, x1, LAYOUT.avenueX, mesh);
    // Flanks of the plaza opening, which no road crosses.
    this.fenceRun(true, -gap, z1, LAYOUT.seaWallZ, [], mesh);
    this.fenceRun(true, gap, z1, LAYOUT.seaWallZ, [], mesh);

    // Scrub and palms on the far side, so what you see through the wire is
    // land rather than a green plane running into the fog.
    let seed = 771;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 30; i++) {
      // Kept near the fence, where they actually screen the view through it.
      // Scattered over a hundred metres they were just more empty ground with
      // trees in it.
      const out = 10 + rnd() * 70;
      const along = rnd();
      const side = Math.floor(rnd() * 4);
      const x = side === 0 ? x0 - out : side === 1 ? x1 + out : x0 + (x1 - x0) * along;
      const z = side === 2 ? z0 - out : side === 3 ? z1 + out : z0 + (z1 - z0) * along;
      const palm = makePalm(6.5 + rnd() * 4, i);
      palm.position.set(x, 0, z);
      this.blockAdd(palm);
    }
  }

  /**
   * One straight run of fence, with a gate wherever a road meets it.
   *
   * `alongZ` says which way the run goes; `offset` is the fixed coordinate.
   * Panels go into the scenery cells like everything else, so the far side of
   * the city costs nothing to have.
   */
  private fenceRun(
    alongZ: boolean, offset: number, from: number, to: number,
    crossings: readonly number[], mesh: THREE.Material,
  ): void {
    const gates = crossings.filter((c) => c > from + 4 && c < to - 4);
    const half = LAYOUT.roadHalf + 1.4;
    const spans: Array<[number, number]> = [];
    let cursor = from;
    for (const c of gates) {
      if (c - half > cursor) spans.push([cursor, c - half]);
      cursor = c + half;
    }
    if (to > cursor) spans.push([cursor, to]);

    for (const [a, b] of spans) {
      // Split so each piece sits in one scenery cell and is culled with it.
      // Divided EXACTLY rather than rounded to a shared length: rounding the
      // length while spacing the centres evenly leaves a gap you can see
      // through at every joint, and a fence is not worth a hole.
      const n = Math.max(1, Math.round((b - a) / 24));
      const len = (b - a) / n;
      for (let i = 0; i < n; i++) this.fencePanel(alongZ, offset, a + len * (i + 0.5), len, mesh);
      // Posts. Every six metres - a real run is spaced at four, but this is
      // two and a half kilometres of fence and a post is twenty-four triangles
      // where a panel is two. They are what stops the wire reading as a decal.
      for (let p = a; p <= b + 0.01; p += 6) this.fencePost(alongZ, offset, Math.min(p, b), 0.05);
    }
    for (const c of gates) this.fenceGate(alongZ, offset, c, half, mesh);
  }

  /** One panel: two triangles, with the wire in the texture. */
  private fencePanel(
    alongZ: boolean, offset: number, centre: number, len: number, mesh: THREE.Material,
  ): void {
    const geo = new THREE.PlaneGeometry(len, FENCE_HEIGHT);
    scaleUV(geo, len / FENCE_TILE, 1);
    const m = new THREE.Mesh(geo, mesh);
    if (alongZ) {
      m.position.set(offset, FENCE_HEIGHT / 2, centre);
      m.rotation.y = Math.PI / 2;
    } else {
      m.position.set(centre, FENCE_HEIGHT / 2, offset);
    }
    this.blockAdd(m);
  }

  /** A galvanised post. Six sides is plenty at the edge of the world. */
  private fencePost(alongZ: boolean, offset: number, at: number, extra: number): void {
    const geo = this.posts ?? (this.posts = new THREE.CylinderGeometry(
      0.045, 0.05, FENCE_HEIGHT + 0.1, 6,
    ));
    const m = new THREE.Mesh(geo, PROP_MATERIALS.chrome);
    const y = (FENCE_HEIGHT + 0.1) / 2 + extra - 0.05;
    if (alongZ) m.position.set(offset, y, at);
    else m.position.set(at, y, offset);
    m.castShadow = true;
    this.blockAdd(m);
  }

  /**
   * A gate across a road: two leaves, chained shut, with a diagonal brace.
   *
   * The brace is the whole point. A flat rectangle of chain link across a
   * street reads as a rendering mistake; a braced frame with a gap down the
   * middle reads as somebody's gate, and tells you the road ended on purpose.
   */
  private fenceGate(
    alongZ: boolean, offset: number, centre: number, half: number, mesh: THREE.Material,
  ): void {
    const h = FENCE_HEIGHT + 0.5;
    const leaf = half - 0.12;
    for (const side of [-1, 1]) {
      // The leaf itself.
      const geo = new THREE.PlaneGeometry(leaf, h);
      scaleUV(geo, leaf / FENCE_TILE, 1);
      const panel = new THREE.Mesh(geo, mesh);
      const at = centre + side * (leaf / 2 + 0.1);
      if (alongZ) {
        panel.position.set(offset, h / 2, at);
        panel.rotation.y = Math.PI / 2;
      } else {
        panel.position.set(at, h / 2, offset);
      }
      this.blockAdd(panel);

      // Frame: two uprights, a top rail, and the diagonal.
      const frame = (len: number, along: number, y: number, tilt: number, vertical: boolean) => {
        const bar = new THREE.Mesh(
          this.slab(vertical ? 0.07 : len, vertical ? len : 0.07, 0.07),
          PROP_MATERIALS.chrome,
        );
        if (alongZ) {
          bar.position.set(offset, y, along);
          bar.rotation.y = Math.PI / 2;
          bar.rotation.x = tilt;
        } else {
          bar.position.set(along, y, offset);
          bar.rotation.z = tilt;
        }
        this.blockAdd(bar);
      };
      frame(h, centre + side * 0.12, h / 2, 0, true);
      frame(h, centre + side * (leaf + 0.1), h / 2, 0, true);
      frame(leaf, at, h - 0.05, 0, false);
      frame(leaf, at, 0.06, 0, false);
      // The diagonal, corner to corner.
      const diag = Math.hypot(leaf, h);
      frame(diag, at, h / 2, side * Math.atan2(h, leaf) * (alongZ ? 1 : -1), false);
    }
    // Posts either side, taller than the run.
    for (const side of [-1, 1]) this.fencePost(alongZ, offset, centre + side * half, 0.55);
  }

  // -------------------------------------------------------- GroundProvider

  /**
   * Raw surface height, before any tyre smoothing.
   *
   * The road surface is the union of every avenue strip and every street strip,
   * so "am I on tarmac" is a distance-to-that-union test rather than anything
   * that knows about a particular street. Off it, the kerb ramps up over 30 cm
   * instead of stepping: the tyre envelope only smooths along the direction of
   * travel, so a hard edge here made the bike flicker whenever it was ridden.
   */
  private rawHeight(x: number, z: number): number {
    const off = distanceOffRoad(x, z);
    if (off > 0) {
      const t = Math.min(1, off / 0.3);
      return KERB_HEIGHT * t * t * (3 - 2 * t);
    }
    // On tarmac: the only thing that lifts it is a muerto.
    for (const b of this.bumps) {
      if (Math.abs(x - b.x) > LAYOUT.roadHalf + 0.6) continue;
      const t = (z - b.z) / b.half;
      if (t > -1 && t < 1) return b.height * bumpProfile(t);
    }
    return 0;
  }

  /**
   * Height the tyre actually rides at, which is not the raw profile: a wheel of
   * radius r rests on the highest point its circle touches, so it rounds off
   * sharp edges the way a real tyre does. Without this a kerb reads as a step
   * and the pitch solver sees an infinite ramp rate.
   */
  heightAt(x: number, z: number, wheelRadius: number): number {
    const samples = 6;
    let best = this.rawHeight(x, z);
    for (let i = 1; i <= samples; i++) {
      const d = (i / samples) * wheelRadius;
      const lift = Math.sqrt(Math.max(0, wheelRadius * wheelRadius - d * d)) - wheelRadius;
      best = Math.max(
        best,
        this.rawHeight(x, z - d) + lift,
        this.rawHeight(x, z + d) + lift,
      );
    }
    return best;
  }

  /**
   * Advance anything in the city that moves, and switch off what is too far to
   * see. Called on the fixed step so the cars the physics tests against are the
   * cars that were drawn.
   */
  update(dt: number, px = 0, pz = 0): void {
    this.traffic.update(dt, px, pz);
    for (const c of this.cells) {
      const dx = c.cx - px;
      const dz = c.cz - pz;
      c.group.visible = dx * dx + dz * dz < CULL_RADIUS * CULL_RADIUS;
    }
  }

  frictionAt(x: number, z: number): number {
    // Anything that isn't road is pavement, and pavement is slick enough to
    // punish riding the kerb line without making it undriveable.
    return distanceOffRoad(x, z) > 0 ? 0.88 : 1.0;
  }

  /**
   * Anything solid that isn't the police.
   *
   * The patrols use this to find out whether they have just driven into a
   * building or a parked car. It deliberately skips `extraCollider`, which is
   * the police themselves - otherwise every patrol would instantly detect
   * itself and wreck on the spot.
   */
  blocked(x: number, z: number, r = 1.1): boolean {
    for (const b of this.colliders) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return this.traffic.hits(x, z, r);
  }

  collide(x: number, z: number, _speed: number): CrashReason | null {
    const r = 0.42;
    for (const b of this.colliders) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) {
        return 'impact';
      }
    }
    if (this.traffic.hits(x, z, r)) return 'impact';
    return this.extraCollider?.(x, z, r) ? 'impact' : null;
  }

  /**
   * Nearest sane place to drop the player back in, facing up the avenue and
   * already rolling in 2nd - which is the gear you want to be in to lift.
   */
  respawnFor(x: number, z: number): SpawnPoint {
    // Always 1st. Coming back in 2nd meant the gear you restarted in depended
    // on whether you had just crashed or just loaded the page, which is exactly
    // the sort of inconsistency that makes a practice loop feel unreliable.
    // BikeSim caps this speed to whatever 1st can actually carry per bike.
    const rolling = { speed: 11, gear: 0 };

    // Drop back onto whichever road is nearest, pointing along it, far enough
    // back to have a run-up. On a grid "back up the avenue" is no longer a
    // meaningful direction on its own - you might have come off on a street.
    const av = nearest(x, LAYOUT.avenueX);
    const st = nearest(z, LAYOUT.streetZ);

    if (av.dist <= st.dist) {
      // Nearest an avenue: face up it, unless that would put you in the sea.
      const forward = z < MAP.zMax - 40;
      const back = forward
        ? Math.max(MAP.zMin + 14, z - 26)
        : Math.min(MAP.zMax - 14, z + 26);
      return { x: av.value, z: back, yaw: forward ? 0 : Math.PI, ...rolling };
    }
    const east = x < MAP.xMax - 40;
    const back = east
      ? Math.max(MAP.xMin + 14, x - 26)
      : Math.min(MAP.xMax - 14, x + 26);
    return { x: back, z: st.value, yaw: east ? -Math.PI / 2 : Math.PI / 2, ...rolling };
  }
}

/**
 * Speed bump cross-section, `t` in -1..1 across the hump, returning 0..1.
 * Shared by the collision heightfield and the mesh generator so they can never
 * disagree about where the road is.
 */
/** Rounds to a step, so sizes repeat and their geometry can be shared. */
function quantise(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function bumpProfile(t: number): number {
  if (t <= -1 || t >= 1) return 0;
  const c = Math.cos((t * Math.PI) / 2);
  return c * c;
}
