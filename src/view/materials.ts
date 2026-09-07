import * as THREE from 'three';

/**
 * Every material in the scene, shared by recipe.
 *
 * After the cell bake, **a cell costs one draw call per distinct material in
 * it**. So two materials that are byte-for-byte the same but were built by two
 * different `new` calls are not a tidiness problem, they are two draw calls
 * where there should be one - and the city was full of them: 617 materials
 * covering 67 distinct recipes, 550 of them duplicates. A row of six buildings
 * with a water tank on each was six identical navy materials and six draw
 * calls, in every cell, forever.
 *
 * This is the same fault the textures had, one level up. `makeShopSign` used to
 * paint a canvas per sign and hand three.js 180 uploads of the same picture;
 * `makeFacadeTexture` cloned per wall for 232. Both were fixed by caching on
 * what the thing IS rather than where it was asked for, and this is that fix
 * applied to materials.
 *
 * Anything whose colour or emissive is animated at runtime - the police
 * beacons, the bomba's light - must NOT come from here, because it would drag
 * every other user of the same recipe along with it. Those stay `new`.
 */
type Spec = THREE.MeshStandardMaterialParameters;

const CACHE = new Map<string, THREE.MeshStandardMaterial>();

function keyOf(spec: Spec): string {
  const parts: string[] = [];
  for (const k of Object.keys(spec).sort()) {
    const v = (spec as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (v instanceof THREE.Color) parts.push(`${k}=#${v.getHexString()}`);
    else if (v instanceof THREE.Texture) parts.push(`${k}=${v.uuid}`);
    else if (typeof v === 'number' && k === 'color') parts.push(`${k}=${v.toString(16)}`);
    else parts.push(`${k}=${String(v)}`);
  }
  return parts.join('|');
}

/** A MeshStandardMaterial, shared with everything else that asked for the same one. */
export function standard(spec: Spec): THREE.MeshStandardMaterial {
  const key = keyOf(spec);
  let mat = CACHE.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial(spec);
    CACHE.set(key, mat);
  }
  return mat;
}

/** How many distinct materials the scene is actually holding. Read by diagnostics. */
export function sharedMaterialCount(): number {
  return CACHE.size;
}
