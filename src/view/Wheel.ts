import * as THREE from 'three';
import { mergeMeshes, roundedBox } from './geometry';

/**
 * Procedural motorcycle wheel: laced spokes, a real rim section, and a tyre
 * with actual tread blocks.
 *
 * The wheels are the closest thing to the chase camera and the only part that
 * moves independently, so they carry a lot of the read. Everything is spec'd
 * rather than hard-coded, because cast 12" street wheels and 21" spoked dirt
 * wheels are the same generator with different numbers.
 *
 * Built with the axle along Z and the wheel in the XY plane, then baked round
 * to an X axle at the end - so the caller can spin it with `rotation.x` and
 * never has to think about Euler order.
 */
export interface WheelSpec {
  /** Overall tyre radius, i.e. rolling radius (m). */
  radius: number;
  /** Tyre section width (m). */
  width: number;
  /** Rim outer radius (m). Bigger gap to `radius` = taller sidewall. */
  rimRadius: number;
  /** Hub body radius (m). */
  hubRadius: number;
  /** Spoke count. 0 gives a cast wheel with solid arms instead. */
  spokes: number;
  /** Spoke lacing cross - how many pitches round the rim each spoke reaches. */
  lacing: number;
  /** Tread blocks around the circumference. 0 = smooth slick. */
  knobs: number;
  /** How far the knobs stand proud of the carcass (m). Dirt: 0.012+. */
  knobHeight: number;
  /** Brake disc radius (m). 0 for none. */
  discRadius: number;
}

export interface WheelMaterials {
  rubber: THREE.Material;
  rim: THREE.Material;
  hub: THREE.Material;
  spoke: THREE.Material;
  disc: THREE.Material;
}

/** A 12" cast street wheel, Grom-style. */
export function castStreetWheel(radius: number, width: number): WheelSpec {
  return {
    radius,
    width,
    rimRadius: radius * 0.66,
    hubRadius: radius * 0.24,
    spokes: 0,
    lacing: 0,
    knobs: 0,
    knobHeight: 0,
    discRadius: radius * 0.52,
  };
}

/** A laced dirt/supermoto wheel with a knobby on it. */
export function spokedDirtWheel(radius: number, width: number): WheelSpec {
  return {
    radius,
    width,
    rimRadius: radius * 0.78,
    hubRadius: radius * 0.17,
    spokes: 32,
    lacing: 2.5,
    knobs: 22,
    knobHeight: 0.014,
    discRadius: radius * 0.44,
  };
}

export function buildWheel(spec: WheelSpec, mats: WheelMaterials): THREE.Group {
  const g = new THREE.Group();
  const halfW = spec.width / 2;

  // ---- tyre ---------------------------------------------------------------
  // Lathed from a real tyre section rather than a torus: a torus has a circular
  // cross-section, so a wide tyre would have to be equally tall and would
  // swallow the rim whole. This way width and sidewall height are independent.
  const rimR = spec.rimRadius;
  const outerR = spec.radius;
  const wall = outerR - rimR;
  const treadHalf = halfW * 0.55;

  const tyreProfile: THREE.Vector2[] = [
    new THREE.Vector2(rimR, -halfW * 0.40),
    new THREE.Vector2(rimR + wall * 0.30, -halfW * 0.88),
    new THREE.Vector2(rimR + wall * 0.70, -halfW * 1.0),
    new THREE.Vector2(outerR - wall * 0.16, -halfW * 0.86),
    new THREE.Vector2(outerR - wall * 0.03, -treadHalf * 1.18),
    new THREE.Vector2(outerR, -treadHalf),
    new THREE.Vector2(outerR, treadHalf),
    new THREE.Vector2(outerR - wall * 0.03, treadHalf * 1.18),
    new THREE.Vector2(outerR - wall * 0.16, halfW * 0.86),
    new THREE.Vector2(rimR + wall * 0.70, halfW * 1.0),
    new THREE.Vector2(rimR + wall * 0.30, halfW * 0.88),
    new THREE.Vector2(rimR, halfW * 0.40),
  ];
  const carcass = new THREE.LatheGeometry(tyreProfile, 48);
  carcass.rotateX(Math.PI / 2);

  const tyreParts: THREE.Mesh[] = [new THREE.Mesh(carcass, mats.rubber)];

  if (spec.knobs > 0) {
    // Three staggered rows: a centre row and two shoulder rows, which is what
    // gives a knobby its blocky silhouette at the edge of the wheel.
    const rows = [
      { axial: 0, phase: 0, surface: outerR, w: spec.width * 0.26, l: 0.052 },
      { axial: treadHalf * 1.05, phase: 0.5, surface: outerR - wall * 0.04, w: spec.width * 0.20, l: 0.042 },
      { axial: -treadHalf * 1.05, phase: 0.5, surface: outerR - wall * 0.04, w: spec.width * 0.20, l: 0.042 },
    ];
    const knobGeoCache = new Map<string, THREE.BufferGeometry>();
    for (const row of rows) {
      const key = `${row.w.toFixed(3)}_${row.l.toFixed(3)}`;
      let geo = knobGeoCache.get(key);
      if (!geo) {
        geo = roundedBox(row.l, spec.knobHeight * 2.0, row.w, spec.knobHeight * 0.55, 4);
        knobGeoCache.set(key, geo);
      }
      for (let i = 0; i < spec.knobs; i++) {
        const a = ((i + row.phase) / spec.knobs) * Math.PI * 2;
        const knob = new THREE.Mesh(geo, mats.rubber);
        knob.position.set(
          Math.cos(a) * (row.surface + spec.knobHeight * 0.35),
          Math.sin(a) * (row.surface + spec.knobHeight * 0.35),
          row.axial,
        );
        // Lay the block flat on the carcass: its local +Y points outward.
        knob.rotation.z = a - Math.PI / 2;
        tyreParts.push(knob);
      }
    }
  }
  const tyre = mergeMeshes(tyreParts, mats.rubber);
  tyre.geometry.rotateY(Math.PI / 2);
  g.add(tyre);

  // ---- rim ----------------------------------------------------------------
  // Lathed section with real flanges and a dropped well, rather than a tube.
  const R = rimR;
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(R, -halfW * 0.62),
    new THREE.Vector2(R - 0.010, -halfW * 0.62),
    new THREE.Vector2(R - 0.030, -halfW * 0.44),
    new THREE.Vector2(R - 0.036, 0),
    new THREE.Vector2(R - 0.030, halfW * 0.44),
    new THREE.Vector2(R - 0.010, halfW * 0.62),
    new THREE.Vector2(R, halfW * 0.62),
  ];
  const rimGeo = new THREE.LatheGeometry(profile, 44);
  // Lathe revolves around Y; bring that axis onto Z, then onto X with the rest.
  rimGeo.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, mats.rim);
  rim.geometry.rotateY(Math.PI / 2);
  rim.castShadow = true;
  g.add(rim);

  // ---- hub + spokes -------------------------------------------------------
  const hubParts: THREE.Mesh[] = [];
  const hubBody = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.hubRadius, spec.hubRadius, spec.width * 0.52, 20),
    mats.hub,
  );
  hubBody.rotation.x = Math.PI / 2;
  hubParts.push(hubBody);
  const flangeOffset = spec.width * 0.30;
  for (const z of [-flangeOffset, flangeOffset]) {
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.hubRadius * 1.45, spec.hubRadius * 1.45, 0.014, 20),
      mats.hub,
    );
    flange.rotation.x = Math.PI / 2;
    flange.position.z = z;
    hubParts.push(flange);
  }
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.hubRadius * 0.42, spec.hubRadius * 0.42, spec.width * 0.95, 14),
    mats.hub,
  );
  axle.rotation.x = Math.PI / 2;
  hubParts.push(axle);
  const hub = mergeMeshes(hubParts, mats.hub);
  hub.geometry.rotateY(Math.PI / 2);
  g.add(hub);

  const spokeParts: THREE.Mesh[] = [];
  if (spec.spokes > 0) {
    const pitch = (Math.PI * 2) / spec.spokes;
    const hubR = spec.hubRadius * 1.42;
    const rimR = R - 0.030;
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < spec.spokes; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const hubA = i * pitch;
      // Laced: each spoke reaches `lacing` pitches round the rim, alternating
      // direction with the flange it comes off. That cross is the whole look.
      const rimA = hubA + side * spec.lacing * pitch;
      const from = new THREE.Vector3(
        Math.cos(hubA) * hubR, Math.sin(hubA) * hubR, side * flangeOffset,
      );
      const to = new THREE.Vector3(Math.cos(rimA) * rimR, Math.sin(rimA) * rimR, 0);
      dir.subVectors(to, from);
      const len = dir.length();
      const spoke = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0045, 0.0045, len, 5), mats.spoke,
      );
      spoke.position.copy(from).addScaledVector(dir, 0.5);
      spoke.quaternion.setFromUnitVectors(up, dir.normalize());
      spokeParts.push(spoke);
    }
  } else {
    // Cast wheel: solid arms instead of spokes.
    const arms = 5;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const armLen = R - spec.hubRadius;
      const arm = new THREE.Mesh(
        roundedBox(spec.width * 0.34, armLen, spec.width * 0.30, spec.width * 0.10, 5),
        mats.spoke,
      );
      arm.position.set(
        Math.cos(a) * (spec.hubRadius + armLen / 2),
        Math.sin(a) * (spec.hubRadius + armLen / 2),
        0,
      );
      arm.rotation.z = a - Math.PI / 2;
      spokeParts.push(arm);
    }
  }
  const spokes = mergeMeshes(spokeParts, mats.spoke);
  spokes.geometry.rotateY(Math.PI / 2);
  spokes.castShadow = true;
  g.add(spokes);

  // ---- brake disc ---------------------------------------------------------
  if (spec.discRadius > 0) {
    const discParts: THREE.Mesh[] = [];
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.discRadius, spec.discRadius, 0.005, 32), mats.disc,
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.z = spec.width * 0.42;
    discParts.push(disc);
    // Drilled holes read as dark dots at distance; a ring of them is enough.
    const carrier = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.discRadius * 0.45, spec.discRadius * 0.45, 0.009, 20),
      mats.disc,
    );
    carrier.rotation.x = Math.PI / 2;
    carrier.position.z = spec.width * 0.42;
    discParts.push(carrier);
    const d = mergeMeshes(discParts, mats.disc);
    d.geometry.rotateY(Math.PI / 2);
    g.add(d);
  }

  return g;
}
