import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Geometry helpers for the bike and rider.
 *
 * Everything in the game is generated at runtime, which is cheap and flexible
 * but was leaving hard 90-degree edges on every panel. These build the same
 * primitives with real fillets and smooth shading across them.
 */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * A box with rounded edges and corners.
 *
 * Takes a subdivided cube and pushes every vertex onto the surface of the
 * Minkowski sum of an inner box and a sphere of `radius` - which is exactly
 * what a filleted box is. Normals are then computed analytically rather than
 * averaged: `computeVertexNormals` would leave hard seams here, because
 * BoxGeometry gives each face its own unshared vertices. Deriving the normal
 * from the position instead means both copies of a seam vertex agree, so the
 * fillets shade smoothly with no welding step.
 */
export function roundedBox(
  width: number, height: number, depth: number, radius: number, segments = 8,
): THREE.BufferGeometry {
  const r = Math.min(radius, width / 2 - 1e-4, height / 2 - 1e-4, depth / 2 - 1e-4);
  const geo = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
  if (r <= 0) return geo;

  const ix = width / 2 - r;
  const iy = height / 2 - r;
  const iz = depth / 2 - r;

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const normals = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Nearest point on the inner box; the offset from it is the outward normal.
    const cx = clamp(x, -ix, ix);
    const cy = clamp(y, -iy, iy);
    const cz = clamp(z, -iz, iz);

    let nx = x - cx;
    let ny = y - cy;
    let nz = z - cz;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      nx /= len; ny /= len; nz /= len;
      pos.setXYZ(i, cx + nx * r, cy + ny * r, cz + nz * r);
    }
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }

  pos.needsUpdate = true;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/**
 * Multiplies a geometry's UVs in place, optionally over just one material group.
 *
 * This is how tiling is set here, instead of `texture.repeat`. Repeat lives on
 * the texture, so every surface that wanted a different tile rate needed its own
 * `clone()` - and three.js uploads every distinct Texture object to the GPU
 * separately even when they all share one image. The city was holding 232
 * textures backed by 54 canvases, which is what ran the Xbox browser out of
 * memory. Baking the rate into the mesh lets one texture serve the whole street.
 */
export function scaleUV(
  geo: THREE.BufferGeometry, sx: number, sy: number, group?: number,
): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return;
  const g = group === undefined ? undefined : geo.groups[group];

  if (!g) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  } else {
    // Walk the group's indices rather than a vertex range: the range only
    // happens to be contiguous for BoxGeometry, and this stays correct if the
    // geometry underneath ever changes. Box faces never share vertices, so
    // scaling one group can't drag a neighbour's UVs with it.
    const index = geo.index;
    if (!index) return;
    const seen = new Set<number>();
    for (let i = g.start; i < g.start + g.count; i++) {
      const v = index.getX(i);
      if (seen.has(v)) continue;
      seen.add(v);
      uv.setXY(v, uv.getX(v) * sx, uv.getY(v) * sy);
    }
  }
  uv.needsUpdate = true;
}

/** Capsule with enough segments to read as round at chase-camera distance. */
export function limbCapsule(radius: number, length: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 10, 24);
}

/**
 * A curved mudguard: a slice of a tube wrapped around the wheel, rather than a
 * flat plank sitting over it.
 */
export function fender(
  wheelRadius: number, width: number, arc: number, offset: number, tilt = 0.3,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    wheelRadius + offset, wheelRadius + offset, width, 28, 1, true, -arc / 2, arc,
  );
  // Cylinder is built along +Y with its arc centred on +Z. Lay the axis along
  // the axle (X), then swing the arc up over the top of the wheel and tip it
  // forward a little, the way a mudguard actually sits.
  geo.rotateZ(Math.PI / 2);
  geo.rotateX(-Math.PI / 2 + tilt);
  return geo;
}

/**
 * A small equirectangular sky/ground image used as the scene environment.
 *
 * Without image-based lighting, painted and chromed surfaces have nothing to
 * reflect and read as flat plastic no matter how round they are. This gives
 * them a bright sky above and warm ground below, which is most of what makes
 * the bike look like it has a finish on it.
 */
export function makeEnvironmentTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.52);
  sky.addColorStop(0, '#2f6fc4');
  sky.addColorStop(0.55, '#8ec4e8');
  sky.addColorStop(1, '#e8f2fb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.52);

  const ground = ctx.createLinearGradient(0, H * 0.52, 0, H);
  // Bright enough to fill downward-facing surfaces. Undersides of awnings and
  // balconies went almost black once the flat ambient came down.
  ground.addColorStop(0, '#cabea6');
  ground.addColorStop(1, '#94897a');
  ctx.fillStyle = ground;
  ctx.fillRect(0, H * 0.52, W, H * 0.48);

  // The sun, roughly where the directional light sits.
  const sun = ctx.createRadialGradient(W * 0.34, H * 0.16, 0, W * 0.34, H * 0.16, H * 0.3);
  sun.addColorStop(0, 'rgba(255,252,238,1)');
  sun.addColorStop(0.25, 'rgba(255,244,215,0.55)');
  sun.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H * 0.6);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Bakes a pile of meshes that share one material into a single mesh.
 *
 * Railings, palm crowns and lamp ironwork are built from dozens of little
 * primitives each. Left as individual meshes they cost a draw call apiece and
 * the street alone was issuing ~2400 of them; merged, the whole lot is one.
 * The inputs are consumed - only the returned mesh should be added to a scene.
 */
export function mergeMeshes(meshes: THREE.Mesh[], material: THREE.Material): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    // Respect a caller that has already baked a world matrix in by hand
    // (matrixAutoUpdate = false); updateMatrix would recompose it from the
    // local TRS and throw that away.
    if (m.matrixAutoUpdate) m.updateMatrix();
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrix);
    g.clearGroups();
    // Merging needs a matching attribute set across every input.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(merged ?? geos[0], material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
