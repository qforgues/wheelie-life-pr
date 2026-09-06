import * as THREE from 'three';
import type { BikeState } from '../sim/types';
import type { BikeTuning } from '../sim/tuning';
import { fender, limbCapsule, roundedBox } from './geometry';
import { buildWheel } from './Wheel';
import { BIKE_VISUALS, type BikeVisual } from './bikeVisuals';

/**
 * Procedural Grom + rider. Built with its REAR CONTACT PATCH at the local
 * origin, because that is the point the sim rotates about, so pitch just works.
 *
 * Node order is deliberate and matters:
 *   root (world position, yaw) > roll > pitch > bike
 * so the three rotations can never fight over Euler order.
 */

/** Height of the rider's hip joint above the rear contact patch (m). */
/** Where the rider sits along the bike at neutral (m from the rear contact). */

/** Hip height the rider's body proportions are authored against (m). */
const RIDER_NOMINAL_HIP = 0.88;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();

interface LimbChain {
  root: THREE.Vector3;
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  end: THREE.Mesh;
  upperLen: number;
  lowerLen: number;
  pole: THREE.Vector3;
  target: 'grip' | 'peg';
  side: number;
}

function makeChain(o: {
  parent: THREE.Object3D;
  root: THREE.Vector3;
  upperLen: number; lowerLen: number;
  upperRadius: number; lowerRadius: number;
  upperMat: THREE.Material; lowerMat: THREE.Material;
  endMat: THREE.Material; endRadius: number;
  pole: THREE.Vector3;
  target: 'grip' | 'peg';
  side: number;
}): LimbChain {
  const bone = (len: number, r: number, mat: THREE.Material) => {
    // Capsules are authored along +Y and re-oriented by the solver.
    const m = new THREE.Mesh(limbCapsule(r, len), mat);
    m.castShadow = true;
    return m;
  };
  const upper = bone(o.upperLen, o.upperRadius, o.upperMat);
  const lower = bone(o.lowerLen, o.lowerRadius, o.lowerMat);
  const end = new THREE.Mesh(new THREE.SphereGeometry(o.endRadius, 16, 12), o.endMat);
  o.parent.add(upper, lower, end);
  return {
    root: o.root.clone(),
    upper, lower, end,
    upperLen: o.upperLen, lowerLen: o.lowerLen,
    pole: o.pole.clone().normalize(),
    target: o.target, side: o.side,
  };
}

/** Places a capsule so it spans `from` to `to`. */
function placeBone(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  _dir.subVectors(to, from);
  const len = _dir.length();
  if (len < 1e-5) return;
  mesh.position.copy(from).addScaledVector(_dir, 0.5);
  _dir.divideScalar(len);
  mesh.quaternion.setFromUnitVectors(UP, _dir);
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Two-bone IK. Puts the elbow/knee on the circle where both bone lengths are
 * satisfied, picking the side the pole vector points to so joints bend the
 * right way. If the target is out of reach the limb simply straightens toward
 * it, which is exactly what an arm does when the rider leans right back.
 */
function solveTwoBone(limb: LimbChain, target: THREE.Vector3): void {
  const { root, upperLen: l1, lowerLen: l2 } = limb;
  _dir.subVectors(target, root);
  let d = _dir.length();
  if (d < 1e-4) return;
  _dir.divideScalar(d);

  const reach = l1 + l2;
  const clamped = Math.min(d, reach * 0.999);
  if (d > clamped) {
    target = _v.copy(root).addScaledVector(_dir, clamped);
    d = clamped;
  }

  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));

  // Component of the pole perpendicular to the bone axis.
  _pole.copy(limb.pole).addScaledVector(_dir, -limb.pole.dot(_dir));
  if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _pole.normalize();

  _elbow.copy(root).addScaledVector(_dir, a).addScaledVector(_pole, h);

  placeBone(limb.upper, root, _elbow);
  placeBone(limb.lower, _elbow, target);
  limb.end.position.copy(target);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function shirtTexture(back: string, line1: string, line2: string, line3: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = back;
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = back === '#1a1a1e' ? '#f4f2ec' : '#1a1a1e';
  x.textAlign = 'center';
  // The torso is a filleted box, so the outer third of the UV space wraps
  // around the rounded edges. Keep the print well inside the flat panel or it
  // gets dragged around the corner and clipped.
  x.font = 'bold 26px "Arial Black", Impact, sans-serif';
  x.fillText(line1, 128, 112);
  x.fillText(line2, 128, 142);
  x.fillText(line3, 128, 172);
  // Little crown, like the box art.
  x.beginPath();
  x.moveTo(110, 88); x.lineTo(118, 74); x.lineTo(128, 86); x.lineTo(138, 74);
  x.lineTo(146, 88); x.closePath();
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Materials shared by every bodywork builder. */
interface BodyMaterials {
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  engine: THREE.MeshStandardMaterial;
}

export class BikeView {
  readonly root = new THREE.Group();
  /** Camera target: roughly the rider's chest, already pitched and rolled. */
  readonly focus = new THREE.Object3D();

  private rollPivot = new THREE.Group();
  private pitchPivot = new THREE.Group();
  private bike = new THREE.Group();
  private rearWheel = new THREE.Group();
  private frontWheel = new THREE.Group();
  private forkGroup = new THREE.Group();
  private riderRoot = new THREE.Group();
  /** Pivot at the rider's hips. Leaning has to rotate about the hips, not
   *  about the road, or the shoulders swing back half a metre. */
  private riderHips = new THREE.Group();
  private riderTorso = new THREE.Group();
  private limbs: LimbChain[] = [];
  private gripLocal: THREE.Vector3[] = [];
  private forkOrigin = new THREE.Vector3();
  private sparks: THREE.Points;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private wheelAngle = 0;
  private readonly R: number;
  private readonly frontR: number;
  private readonly WB: number;
  private readonly shiftRange: number;
  private readonly visual: BikeVisual;
  private readonly hipY: number;
  private readonly seatZ: number;
  private readonly pegLocal: THREE.Vector3;

  constructor(tuning: BikeTuning, visual: BikeVisual = BIKE_VISUALS.yz250f) {
    this.visual = visual;
    this.R = tuning.chassis.wheelRadius;
    this.frontR = visual.frontWheelRadius;
    this.WB = tuning.chassis.wheelbase;
    this.hipY = visual.hipHeight;
    this.seatZ = visual.seatZ;
    this.pegLocal = new THREE.Vector3(...visual.pegLocal);
    this.shiftRange = Math.max(0.01, tuning.rider.weightShiftRange);
    const WB = this.WB;

    this.root.add(this.rollPivot);
    this.rollPivot.add(this.pitchPivot);
    this.pitchPivot.add(this.bike);
    this.pitchPivot.add(this.focus);
    this.focus.position.set(0, 1.05, WB * 0.45);

    const body = new THREE.MeshStandardMaterial({
      color: visual.bodyColor, roughness: 0.32, metalness: 0.45,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: visual.accentColor, roughness: 0.5, metalness: 0.1,
    });
    const black = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x101115, roughness: 0.95 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.28, metalness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: visual.rimColor, roughness: 0.3, metalness: 0.8 });
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.55, metalness: 0.6 });

    // ---- wheels ----------------------------------------------------------
    // Laced spokes and real tread blocks. These are the closest thing to the
    // chase camera and the only part that spins, so they carry a lot of the
    // read - see view/Wheel.ts.
    const wheelMats = {
      rubber,
      rim: rimMat,
      hub: new THREE.MeshStandardMaterial({ color: 0x8e9299, roughness: 0.4, metalness: 0.85 }),
      spoke: new THREE.MeshStandardMaterial({ color: 0xd6dae0, roughness: 0.3, metalness: 0.9 }),
      disc: metal,
    };
    this.rearWheel = buildWheel(visual.rearWheel, wheelMats);
    this.rearWheel.position.set(0, this.R, 0);
    this.bike.add(this.rearWheel);

    this.frontWheel = buildWheel(visual.frontWheel, wheelMats);
    this.frontWheel.position.set(0, 0, 0);
    // Front axle rides at ITS OWN rolling radius - on a dirt bike the 21" front
    // sits 16 mm higher than the 19" rear, which is part of the stance.
    this.forkGroup.position.set(0, this.frontR, WB);
    this.forkGroup.add(this.frontWheel);
    this.bike.add(this.forkGroup);

    this.buildBodywork({ body, accent, black, rubber, metal, engine: engineMat });

    // Foot pegs, positioned from the bike's spec.
    for (const dx of [-1, 1]) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.15, 14), metal);
      peg.rotation.z = Math.PI / 2;
      peg.position.set(dx * this.pegLocal.x, this.pegLocal.y - 0.06, this.pegLocal.z);
      this.bike.add(peg);
    }

    // ---- rider -----------------------------------------------------------
    this.forkOrigin.set(0, this.frontR, WB);
    const [gx, gy, gz] = visual.gripLocal;
    this.gripLocal = [new THREE.Vector3(-gx, gy, gz), new THREE.Vector3(gx, gy, gz)];
    this.buildRider(visual.shirt);
    this.riderRoot.position.set(0, 0, this.seatZ);
    this.riderRoot.add(this.riderHips);
    this.riderHips.position.set(0, this.hipY, 0);
    this.bike.add(this.riderRoot);

    // ---- sparks ----------------------------------------------------------
    const SPARKS = 90;
    const pos = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffb648, size: 0.07, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.sparks.frustumCulled = false;
    this.root.add(this.sparks);
  }

  private buildRider(shirt: [string, string, string, string]): void {
    // Everything below is positioned relative to the HIPS, not the road, so a
    // lean rotates the body about the rider's waist the way a body actually
    // hinges. y = 0 here is hip height.
    // Body measurements below are absolute heights for a rider whose hips sit
    // at RIDER_NOMINAL_HIP. Subtracting the *bike's* hip height here instead
    // would squash the torso on a tall bike and stretch it on a short one - the
    // rider is the same person on every bike, only their hips move.
    const V = (x: number, y: number, z: number) =>
      new THREE.Vector3(x, y - RIDER_NOMINAL_HIP, z);
    const skin = new THREE.MeshStandardMaterial({ color: 0xa9713f, roughness: 0.8 });
    const denim = new THREE.MeshStandardMaterial({ color: 0x3a4a68, roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.85 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.25, metalness: 0.3 });
    const visor = new THREE.MeshStandardMaterial({
      color: 0x1a2430, roughness: 0.1, metalness: 0.7, transparent: true, opacity: 0.9,
    });
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirt[0], roughness: 0.92 });
    const shirtBack = new THREE.MeshStandardMaterial({
      map: shirtTexture(shirt[0], shirt[1], shirt[2], shirt[3]), roughness: 0.92,
    });

    const torso = new THREE.Mesh(
      roundedBox(0.32, 0.46, 0.21, 0.058, 12),
      [shirtMat, shirtMat, shirtMat, shirtMat, shirtMat, shirtBack],
    );
    torso.position.copy(V(0, 1.14, 0));
    torso.castShadow = true;
    this.riderTorso.add(torso);

    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 8, 20), shirtMat);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.copy(V(0, 1.34, 0.01));
    shoulders.castShadow = true;
    this.riderTorso.add(shoulders);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 16), skin);
    neck.position.copy(V(0, 1.42, 0.02));
    this.riderTorso.add(neck);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 24), helmetMat);
    helmet.position.copy(V(0, 1.53, 0.02));
    helmet.castShadow = true;
    this.riderTorso.add(helmet);
    const chinbar = new THREE.Mesh(roundedBox(0.185, 0.115, 0.14, 0.05, 10), helmetMat);
    chinbar.position.copy(V(0, 1.47, 0.13));
    this.riderTorso.add(chinbar);
    const vis = new THREE.Mesh(roundedBox(0.20, 0.105, 0.055, 0.026, 8), visor);
    vis.position.copy(V(0, 1.56, 0.13));
    this.riderTorso.add(vis);
    const peak = new THREE.Mesh(roundedBox(0.185, 0.022, 0.115, 0.010, 6), helmetMat);
    peak.position.copy(V(0, 1.598, 0.125));
    peak.rotation.x = 0.34;
    this.riderTorso.add(peak);
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.142, 28, 16, 0, Math.PI * 2, 0, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xe9c750, roughness: 0.35, metalness: 0.5 }),
    );
    crown.position.copy(helmet.position);
    this.riderTorso.add(crown);

    // Arms and legs are IK chains solved every frame in `update`, so the hands
    // stay on the grips and the feet stay on the pegs no matter how the body
    // moves. Rest lengths are set here; the solver never changes them.
    for (const side of [-1, 1]) {
      this.limbs.push(makeChain({
        parent: this.riderTorso,
        root: V(side * 0.17, 1.32, 0.03),
        upperLen: 0.325, lowerLen: 0.315,
        upperRadius: 0.052, lowerRadius: 0.044,
        upperMat: shirtMat, lowerMat: skin,
        endMat: skin, endRadius: 0.055,
        pole: new THREE.Vector3(side * 0.9, -0.35, -0.25),
        target: 'grip', side,
      }));
      this.limbs.push(makeChain({
        parent: this.riderTorso,
        root: V(side * 0.11, 0.94, 0.02),
        upperLen: 0.37, lowerLen: 0.35,
        upperRadius: 0.075, lowerRadius: 0.062,
        upperMat: denim, lowerMat: denim,
        endMat: shoe, endRadius: 0.06,
        pole: new THREE.Vector3(side * 0.8, -0.1, 0.9),
        target: 'peg', side,
      }));
    }

    this.riderHips.add(this.riderTorso);
  }


  /** Builds the bodywork for whichever bike this is. */
  private buildBodywork(m: BodyMaterials): void {
    if (this.visual.style === 'dirt') this.buildDirtBodywork(m);
    else this.buildMiniBodywork(m);
  }

  /** Honda Grom: small, low, street. */
  private buildMiniBodywork(m: BodyMaterials): void {
    // ---- frame -----------------------------------------------------------
    // Laid out to real Grom geometry, in metres from the rear contact patch:
    // rear axle at z=0, front axle at z=1.20, seat 0.78, steering head 0.88 at
    // z=0.97, forks raked 20 degrees. Getting these right matters more than any
    // amount of detail - the earlier layout had the tank, seat and tail as one
    // continuous slab and the forks raking backwards.

    const swingarm = new THREE.Mesh(roundedBox(0.24, 0.09, 0.48, 0.04, 8), m.black);
    swingarm.position.set(0, 0.29, 0.23);
    swingarm.rotation.x = -0.10;
    swingarm.castShadow = true;
    this.bike.add(swingarm);

    // Rear shock, swingarm up to the subframe.
    const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.26, 14), m.metal);
    shock.position.set(-0.055, 0.44, 0.26);
    shock.rotation.x = 0.46;
    this.bike.add(shock);
    const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 16), m.body);
    spring.position.set(-0.055, 0.42, 0.245);
    spring.rotation.x = 0.46;
    this.bike.add(spring);

    const engine = new THREE.Mesh(roundedBox(0.28, 0.30, 0.30, 0.055, 10), m.engine);
    engine.position.set(0, 0.43, 0.60);
    engine.castShadow = true;
    this.bike.add(engine);

    // Cylinder canted forward off the crankcase, the way a horizontal single is.
    const barrel = new THREE.Mesh(roundedBox(0.22, 0.20, 0.17, 0.04, 8), m.engine);
    barrel.position.set(0, 0.62, 0.68);
    barrel.rotation.x = -0.38;
    barrel.castShadow = true;
    this.bike.add(barrel);
    const cam = new THREE.Mesh(roundedBox(0.19, 0.09, 0.14, 0.035, 6), m.metal);
    cam.position.set(0, 0.73, 0.73);
    cam.rotation.x = -0.38;
    this.bike.add(cam);

    // Frame: a downtube from the steering head to the engine, and a backbone
    // running back to the seat. Without these the bike reads as loose parts.
    const downtube = new THREE.Mesh(roundedBox(0.075, 0.075, 0.46, 0.034, 6), m.body);
    downtube.position.set(0, 0.66, 0.84);
    downtube.rotation.x = 0.72;
    downtube.castShadow = true;
    this.bike.add(downtube);

    const backbone = new THREE.Mesh(roundedBox(0.10, 0.11, 0.62, 0.045, 8), m.body);
    backbone.position.set(0, 0.76, 0.62);
    backbone.rotation.x = -0.13;
    backbone.castShadow = true;
    this.bike.add(backbone);

    const subframe = new THREE.Mesh(roundedBox(0.19, 0.08, 0.42, 0.035, 8), m.body);
    subframe.position.set(0, 0.70, 0.24);
    subframe.rotation.x = -0.09;
    subframe.castShadow = true;
    this.bike.add(subframe);

    // Tank sits proud of the backbone, clearly ahead of and above the seat.
    const tank = new THREE.Mesh(roundedBox(0.27, 0.23, 0.34, 0.095, 12), m.body);
    tank.position.set(0, 0.86, 0.76);
    tank.rotation.x = -0.06;
    tank.castShadow = true;
    this.bike.add(tank);

    const seat = new THREE.Mesh(roundedBox(0.23, 0.09, 0.42, 0.042, 10), m.black);
    seat.position.set(0, 0.79, 0.35);
    seat.rotation.x = -0.04;
    seat.castShadow = true;
    this.bike.add(seat);

    const tail = new THREE.Mesh(roundedBox(0.19, 0.13, 0.24, 0.055, 10), m.body);
    tail.position.set(0, 0.76, 0.06);
    tail.rotation.x = -0.18;
    tail.castShadow = true;
    this.bike.add(tail);

    // Tail light + plate: this is what drags when you go too far.
    const plate = new THREE.Mesh(
      roundedBox(0.17, 0.12, 0.025, 0.012, 5),
      new THREE.MeshStandardMaterial({ color: 0xf0efe6, roughness: 0.8 }),
    );
    plate.position.set(0, 0.60, -0.05);
    plate.rotation.x = 0.35;
    this.bike.add(plate);
    const tailLight = new THREE.Mesh(
      roundedBox(0.13, 0.05, 0.05, 0.022, 5),
      new THREE.MeshStandardMaterial({
        color: 0xd8262c, emissive: 0x8c0d12, emissiveIntensity: 0.6, roughness: 0.3,
      }),
    );
    tailLight.position.set(0, 0.71, -0.05);
    this.bike.add(tailLight);

    // Exhaust: header off the cylinder, sweeping back to the can on the right.
    const header = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.52, 16), m.metal);
    header.position.set(0.08, 0.44, 0.56);
    header.rotation.set(Math.PI / 2 - 0.25, 0.22, 0);
    header.castShadow = true;
    this.bike.add(header);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.32, 20), m.black);
    can.rotation.set(Math.PI / 2 - 0.06, 0, 0);
    can.position.set(0.13, 0.40, 0.12);
    can.castShadow = true;
    this.bike.add(can);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 18), m.metal);
    tip.rotation.set(Math.PI / 2 - 0.06, 0, 0);
    tip.position.set(0.13, 0.39, -0.06);
    this.bike.add(tip);

    // Chain run.
    const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.018, 20), m.metal);
    sprocket.rotation.z = Math.PI / 2;
    sprocket.position.set(-0.085, 0.24, 0);
    this.bike.add(sprocket);

    // ---- front end -------------------------------------------------------
    // Everything here lives inside forkGroup, whose origin IS the front axle,
    // so the whole assembly steers and rakes as one unit.
    const CLAMP_Y = 0.66;   // triple clamp height above the axle
    const CLAMP_Z = -0.24;  // and how far behind it - this pair sets the rake
    const rake = -Math.atan2(-CLAMP_Z, CLAMP_Y); // ~20 degrees

    for (const dx of [-0.095, 0.095]) {
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.40, 18), m.black);
      lower.position.set(dx, CLAMP_Y * 0.28, CLAMP_Z * 0.28);
      lower.rotation.x = rake;
      lower.castShadow = true;
      this.forkGroup.add(lower);

      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.40, 18), m.metal);
      upper.position.set(dx, CLAMP_Y * 0.72, CLAMP_Z * 0.72);
      upper.rotation.x = rake;
      upper.castShadow = true;
      this.forkGroup.add(upper);
    }

    const triple = new THREE.Mesh(roundedBox(0.23, 0.055, 0.13, 0.024, 6), m.black);
    triple.position.set(0, CLAMP_Y, CLAMP_Z);
    triple.rotation.x = rake;
    this.forkGroup.add(triple);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 14), m.metal);
    stem.position.set(0, CLAMP_Y + 0.06, CLAMP_Z - 0.02);
    stem.rotation.x = rake;
    this.forkGroup.add(stem);

    // Bars, with a little rise and pullback.
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.58, 16), m.black);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.74, -0.27);
    this.forkGroup.add(bar);
    for (const dx of [-0.29, 0.29]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 16), m.rubber);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(dx, 0.74, -0.27);
      this.forkGroup.add(grip);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.13, 10), m.metal);
      lever.rotation.set(0, 0, Math.PI / 2);
      lever.position.set(dx * 0.72, 0.735, -0.20);
      this.forkGroup.add(lever);
    }

    const headlight = new THREE.Mesh(roundedBox(0.19, 0.16, 0.11, 0.05, 8), m.black);
    headlight.position.set(0, 0.60, -0.10);
    headlight.rotation.x = rake;
    this.forkGroup.add(headlight);
    const lens = new THREE.Mesh(
      roundedBox(0.145, 0.115, 0.04, 0.018, 6),
      new THREE.MeshStandardMaterial({
        color: 0xfff3d0, emissive: 0xfff0c0, emissiveIntensity: 0.5, roughness: 0.2,
      }),
    );
    lens.position.set(0, 0.605, -0.045);
    lens.rotation.x = rake;
    this.forkGroup.add(lens);

    // Curved mudguard wrapped around the wheel instead of a plank over it.
    // Open-ended, so it needs to be visible from underneath too.
    const guardMat = m.body.clone();
    guardMat.side = THREE.DoubleSide;
    const guard = new THREE.Mesh(fender(this.R, 0.20, 2.1, 0.075, 0.22), guardMat);
    guard.castShadow = true;
    this.forkGroup.add(guard);

  }


  /**
   * 2024 Yamaha YZ250F.
   *
   * Real proportions in metres from the rear contact patch: 1.475 m wheelbase,
   * 0.975 m seat, 21" front / 19" rear, 12 inches of travel at each end, and a
   * 27-degree rake. A motocrosser is mostly air - the visual mass is a tall
   * narrow tank flanked by shrouds, a long flat seat and a high tail, sitting
   * on very long legs. Building it low and full would read as a road bike.
   */
  private buildDirtBodywork(m: BodyMaterials): void {
    const WB = this.WB;
    const rad = new THREE.MeshStandardMaterial({ color: 0x7f858e, roughness: 0.5, metalness: 0.7 });

    // ---- swingarm + linkage ------------------------------------------------
    const swingarm = new THREE.Mesh(roundedBox(0.22, 0.10, 0.62, 0.04, 8), m.metal);
    swingarm.position.set(0, 0.38, 0.28);
    swingarm.rotation.x = -0.13;
    swingarm.castShadow = true;
    this.bike.add(swingarm);
    const chainGuide = new THREE.Mesh(roundedBox(0.05, 0.05, 0.30, 0.02, 4), m.black);
    chainGuide.position.set(-0.085, 0.44, 0.36);
    this.bike.add(chainGuide);
    const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.012, 24), m.metal);
    sprocket.rotation.z = Math.PI / 2;
    sprocket.position.set(-0.075, this.R, 0);
    this.bike.add(sprocket);

    // Shock, nearly vertical and buried in the frame.
    const shockBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.30, 16), m.metal);
    shockBody.position.set(0, 0.72, 0.56);
    shockBody.rotation.x = 0.14;
    this.bike.add(shockBody);
    const shockSpring = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.26, 18), m.body);
    shockSpring.position.set(0, 0.60, 0.54);
    shockSpring.rotation.x = 0.14;
    this.bike.add(shockSpring);

    // ---- engine ------------------------------------------------------------
    const cases = new THREE.Mesh(roundedBox(0.26, 0.30, 0.34, 0.06, 10), m.engine);
    cases.position.set(0, 0.52, 0.66);
    cases.castShadow = true;
    this.bike.add(cases);
    // Cylinder leans back on a modern 250F, with the airbox feeding it from the
    // front - that rearward cant is a big part of the silhouette.
    const barrel = new THREE.Mesh(roundedBox(0.21, 0.26, 0.19, 0.045, 8), m.engine);
    barrel.position.set(0, 0.78, 0.61);
    barrel.rotation.x = 0.30;
    barrel.castShadow = true;
    this.bike.add(barrel);
    const head = new THREE.Mesh(roundedBox(0.23, 0.14, 0.20, 0.045, 8), m.metal);
    head.position.set(0, 0.94, 0.57);
    head.rotation.x = 0.30;
    this.bike.add(head);
    const skid = new THREE.Mesh(roundedBox(0.28, 0.05, 0.42, 0.03, 5), m.accent);
    skid.position.set(0, 0.365, 0.68);
    skid.castShadow = true;
    this.bike.add(skid);

    // ---- frame -------------------------------------------------------------
    // Twin spars sweeping from the steering head down and back to the swingarm.
    for (const dx of [-0.10, 0.10]) {
      const spar = new THREE.Mesh(roundedBox(0.055, 0.075, 0.68, 0.026, 6), m.metal);
      spar.position.set(dx, 0.86, 0.90);
      spar.rotation.x = 0.34;
      spar.castShadow = true;
      this.bike.add(spar);
      const down = new THREE.Mesh(roundedBox(0.05, 0.05, 0.52, 0.023, 6), m.metal);
      down.position.set(dx * 0.62, 0.66, 0.94);
      down.rotation.x = 0.95;
      this.bike.add(down);
    }
    const subframe = new THREE.Mesh(roundedBox(0.20, 0.07, 0.60, 0.03, 6), m.metal);
    subframe.position.set(0, 0.86, 0.32);
    subframe.rotation.x = -0.14;
    subframe.castShadow = true;
    this.bike.add(subframe);

    // ---- radiators + shrouds ----------------------------------------------
    for (const dx of [-1, 1]) {
      const radiator = new THREE.Mesh(roundedBox(0.05, 0.26, 0.20, 0.02, 5), rad);
      radiator.position.set(dx * 0.15, 0.86, 1.02);
      this.bike.add(radiator);
      // The shrouds are the bike's face: big, flared, carrying the numbers.
      const shroud = new THREE.Mesh(roundedBox(0.055, 0.30, 0.46, 0.075, 8), m.body);
      shroud.position.set(dx * 0.185, 0.88, 0.98);
      shroud.rotation.set(0.08, dx * -0.13, dx * 0.05);
      shroud.castShadow = true;
      this.bike.add(shroud);
      const plate = new THREE.Mesh(roundedBox(0.02, 0.19, 0.26, 0.045, 6), m.accent);
      plate.position.set(dx * 0.215, 0.88, 0.95);
      plate.rotation.set(0.08, dx * -0.13, dx * 0.05);
      this.bike.add(plate);
    }

    // ---- tank + seat + tail -----------------------------------------------
    // Tank is narrow and hides between the shrouds; the visual bulk is bodywork.
    const tank = new THREE.Mesh(roundedBox(0.20, 0.20, 0.34, 0.075, 10), m.body);
    tank.position.set(0, 0.94, 0.90);
    this.bike.add(tank);

    const seat = new THREE.Mesh(roundedBox(0.20, 0.09, 0.66, 0.042, 10), m.black);
    seat.position.set(0, 0.955, 0.56);
    seat.rotation.x = -0.06;
    seat.castShadow = true;
    this.bike.add(seat);
    // Seat kicks up towards the tank the way an MX seat does.
    const seatFront = new THREE.Mesh(roundedBox(0.17, 0.09, 0.22, 0.04, 8), m.black);
    seatFront.position.set(0, 1.00, 0.88);
    seatFront.rotation.x = -0.30;
    this.bike.add(seatFront);

    // High flat rear fender, carrying the tail light and plate.
    const rearFender = new THREE.Mesh(roundedBox(0.24, 0.05, 0.50, 0.045, 8), m.body);
    rearFender.position.set(0, 0.94, 0.10);
    rearFender.rotation.x = -0.16;
    rearFender.castShadow = true;
    this.bike.add(rearFender);
    const tailLight = new THREE.Mesh(
      roundedBox(0.12, 0.05, 0.05, 0.022, 5),
      new THREE.MeshStandardMaterial({
        color: 0xd8262c, emissive: 0x8c0d12, emissiveIntensity: 0.6, roughness: 0.3,
      }),
    );
    tailLight.position.set(0, 0.95, -0.14);
    this.bike.add(tailLight);

    // ---- exhaust -----------------------------------------------------------
    const header = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.60, 16), m.metal);
    header.position.set(0.10, 0.72, 0.82);
    header.rotation.set(Math.PI / 2 - 0.55, 0.30, 0);
    header.castShadow = true;
    this.bike.add(header);
    const midpipe = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.46, 16), m.metal);
    midpipe.position.set(0.15, 0.74, 0.48);
    midpipe.rotation.set(Math.PI / 2 - 0.16, 0.12, 0);
    this.bike.add(midpipe);
    const silencer = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.40, 20), m.metal);
    silencer.position.set(0.17, 0.80, 0.14);
    silencer.rotation.set(Math.PI / 2 - 0.10, 0.05, 0);
    silencer.castShadow = true;
    this.bike.add(silencer);

    // ---- front end ---------------------------------------------------------
    // Inverted forks with 12" of travel. The clamp offsets set the 27-degree
    // rake, rather than the rake being typed in and the parts placed to match.
    const CLAMP_Y = 0.84;
    const CLAMP_Z = -0.43;
    const rake = -Math.atan2(-CLAMP_Z, CLAMP_Y);

    for (const dx of [-0.115, 0.115]) {
      // Fat gold upper tube, thin black slider below - the inverted look.
      const upperTube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.041, 0.041, 0.56, 20), m.metal,
      );
      upperTube.position.set(dx, CLAMP_Y * 0.70, CLAMP_Z * 0.70);
      upperTube.rotation.x = rake;
      upperTube.castShadow = true;
      this.forkGroup.add(upperTube);

      const slider = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.036, 0.46, 18), m.black);
      slider.position.set(dx, CLAMP_Y * 0.24, CLAMP_Z * 0.24);
      slider.rotation.x = rake;
      slider.castShadow = true;
      this.forkGroup.add(slider);
    }

    for (const [y, w] of [[CLAMP_Y, 0.30], [CLAMP_Y - 0.13, 0.30]] as const) {
      const clamp = new THREE.Mesh(roundedBox(w, 0.05, 0.14, 0.022, 6), m.metal);
      clamp.position.set(0, y, CLAMP_Z * (y / CLAMP_Y));
      clamp.rotation.x = rake;
      this.forkGroup.add(clamp);
    }

    // Tall fat bars on risers, with a crossbar pad.
    const [gx, gy, gz] = this.visual.gripLocal;
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.10, 12), m.metal);
    riser.position.set(0, CLAMP_Y + 0.06, CLAMP_Z);
    this.forkGroup.add(riser);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, gx * 2.1, 16), m.black);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, gy, gz);
    this.forkGroup.add(bar);
    const pad = new THREE.Mesh(roundedBox(0.20, 0.07, 0.07, 0.03, 6), m.body);
    pad.position.set(0, gy + 0.01, gz + 0.005);
    this.forkGroup.add(pad);
    for (const dx of [-gx, gx]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.13, 16), m.rubber);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(dx, gy, gz);
      this.forkGroup.add(grip);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.14, 10), m.metal);
      lever.rotation.z = Math.PI / 2;
      lever.position.set(dx * 0.70, gy - 0.01, gz + 0.07);
      this.forkGroup.add(lever);
    }

    // Front number plate rather than a headlight - it's a motocrosser.
    const numberPlate = new THREE.Mesh(roundedBox(0.26, 0.24, 0.035, 0.07, 8), m.accent);
    numberPlate.position.set(0, CLAMP_Y - 0.02, CLAMP_Z + 0.16);
    numberPlate.rotation.x = rake + 0.15;
    numberPlate.castShadow = true;
    this.forkGroup.add(numberPlate);

    // MX front fender: mounted high on the clamps and sweeping forward, nowhere
    // near the tyre - very different from a road bike's hugger.
    const frontFender = new THREE.Mesh(roundedBox(0.26, 0.045, 0.60, 0.05, 8), m.body);
    frontFender.position.set(0, CLAMP_Y - 0.30, CLAMP_Z + 0.34);
    frontFender.rotation.x = -0.20;
    frontFender.castShadow = true;
    this.forkGroup.add(frontFender);

    void WB;
  }

  /** Push a frame of sim state into the scene graph. */
  update(state: BikeState, wheelSpin: number, weightShift: number, dt: number): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.yaw;
    this.rollPivot.rotation.z = state.roll;
    this.pitchPivot.rotation.x = -state.pitch;

    this.wheelAngle -= wheelSpin * dt;
    this.rearWheel.rotation.x = this.wheelAngle;
    // Front wheel freewheels; it stops spinning once it's in the air.
    const airborne = state.pitch > 0.02;
    this.frontWheel.rotation.x = airborne
      ? this.frontWheel.rotation.x - (state.speed / this.R) * dt * 0.55
      : this.wheelAngle;

    // Countersteer the bars into the turn, and stiff-arm them when the front is up.
    this.forkGroup.rotation.y = -state.yawRate * 0.22 - state.roll * 0.12;

    // Rider body english. Normalised against the *actual* tuned travel rather
    // than a hard-coded number, so retuning weightShiftRange can't over-drive
    // the animation past its rig.
    const back = clamp01(Math.max(0, weightShift) / this.shiftRange);
    const fwd = clamp01(Math.max(0, -weightShift) / (this.shiftRange * 0.35));
    // Hips slide back along the seat; the body hinges about them.
    this.riderRoot.position.z = this.seatZ - back * 0.13 + fwd * 0.08;
    this.riderHips.rotation.x = -0.06 - back * 0.16 + fwd * 0.30 + state.pitch * 0.10;
    this.riderHips.rotation.z = -state.roll * 0.45;

    this.solveLimbs();

    this.updateSparks(state, dt);
  }

  private updateSparks(state: BikeState, dt: number): void {
    const attr = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const count = this.sparkLife.length;

    if (state.scraping) {
      // Spawn from the tail, in world space, trailing behind the bike.
      const tail = new THREE.Vector3(0, 0.55, -0.12);
      this.pitchPivot.localToWorld(tail);
      let spawned = 0;
      for (let i = 0; i < count && spawned < 4; i++) {
        if (this.sparkLife[i] > 0) continue;
        arr[i * 3] = tail.x + (Math.random() - 0.5) * 0.12;
        arr[i * 3 + 1] = tail.y;
        arr[i * 3 + 2] = tail.z + (Math.random() - 0.5) * 0.12;
        const back = -Math.sin(state.yaw);
        const backZ = -Math.cos(state.yaw);
        this.sparkVel[i * 3] = back * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 2;
        this.sparkVel[i * 3 + 1] = 1.2 + Math.random() * 2.2;
        this.sparkVel[i * 3 + 2] = backZ * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 2;
        this.sparkLife[i] = 0.35 + Math.random() * 0.3;
        spawned++;
      }
    }

    for (let i = 0; i < count; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 11 * dt;
      arr[i * 3] += this.sparkVel[i * 3] * dt;
      arr[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      arr[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (arr[i * 3 + 1] < 0.02) {
        arr[i * 3 + 1] = 0.02;
        this.sparkVel[i * 3 + 1] *= -0.35;
      }
      if (this.sparkLife[i] <= 0) arr[i * 3 + 1] = -999;
    }
    attr.needsUpdate = true;
  }

  /**
   * Re-aims the arms and legs so the hands stay on the grips and the feet on
   * the pegs. Everything is solved in the torso's local space, which is why the
   * rider can lean around without coming off the bike.
   */
  private solveLimbs(): void {
    const hipsQuat = _q.setFromEuler(this.riderHips.rotation).invert();
    const rootZ = this.riderRoot.position.z;
    const forkYaw = this.forkGroup.rotation.y;

    for (const limb of this.limbs) {
      // Target in BIKE space.
      if (limb.target === 'grip') {
        const g = this.gripLocal[limb.side < 0 ? 0 : 1];
        // The bars steer, so the grips move with them.
        _v.set(
          g.x * Math.cos(forkYaw) + g.z * Math.sin(forkYaw),
          g.y,
          -g.x * Math.sin(forkYaw) + g.z * Math.cos(forkYaw),
        ).add(this.forkOrigin);
      } else {
        _v.copy(this.pegLocal);
        _v.x *= limb.side;
      }
      // Bike space -> riderRoot -> riderHips (== riderTorso, which has no
      // transform of its own).
      _v.z -= rootZ;
      _v.y -= this.hipY;
      _v.applyQuaternion(hipsQuat);
      solveTwoBone(limb, _v);
    }
  }

  /** World-space point the camera should look at. */
  getFocusWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.focus.getWorldPosition(out);
  }
}
