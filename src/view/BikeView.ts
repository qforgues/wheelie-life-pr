import * as THREE from 'three';
import type { BikeState } from '../sim/types';
import type { BikeTuning } from '../sim/tuning';

/**
 * Procedural Grom + rider. Built with its REAR CONTACT PATCH at the local
 * origin, because that is the point the sim rotates about, so pitch just works.
 *
 * Node order is deliberate and matters:
 *   root (world position, yaw) > roll > pitch > bike
 * so the three rotations can never fight over Euler order.
 */

/** Height of the rider's hip joint above the rear contact patch (m). */
const HIP_Y = 0.92;
/** Where the rider sits along the bike at neutral (m from the rear contact). */
const RIDER_SEAT_Z = 0.46;

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
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 8), mat);
    m.castShadow = true;
    return m;
  };
  const upper = bone(o.upperLen, o.upperRadius, o.upperMat);
  const lower = bone(o.lowerLen, o.lowerRadius, o.lowerMat);
  const end = new THREE.Mesh(new THREE.SphereGeometry(o.endRadius, 8, 6), o.endMat);
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
  x.font = 'bold 34px "Arial Black", Impact, sans-serif';
  x.fillText(line1, 128, 96);
  x.fillText(line2, 128, 136);
  x.fillText(line3, 128, 176);
  // Little crown, like the box art.
  x.beginPath();
  x.moveTo(104, 62); x.lineTo(114, 44); x.lineTo(128, 60); x.lineTo(142, 44);
  x.lineTo(152, 62); x.closePath();
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface BikeViewOptions {
  bodyColor?: number;
  shirt?: [string, string, string, string];
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
  private readonly shiftRange: number;

  constructor(tuning: BikeTuning, opts: BikeViewOptions = {}) {
    this.R = tuning.chassis.wheelRadius;
    this.shiftRange = Math.max(0.01, tuning.rider.weightShiftRange);
    const WB = tuning.chassis.wheelbase;

    this.root.add(this.rollPivot);
    this.rollPivot.add(this.pitchPivot);
    this.pitchPivot.add(this.bike);
    this.pitchPivot.add(this.focus);
    this.focus.position.set(0, 1.05, WB * 0.45);

    const body = new THREE.MeshStandardMaterial({
      color: opts.bodyColor ?? 0x1f5fd0, roughness: 0.32, metalness: 0.45,
    });
    const black = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x101115, roughness: 0.95 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.28, metalness: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.8 });
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.55, metalness: 0.6 });

    // ---- wheels ----------------------------------------------------------
    const buildWheel = (radius: number, width: number, rimMat: THREE.Material) => {
      const g = new THREE.Group();
      const tyre = new THREE.Mesh(
        new THREE.TorusGeometry(radius - width * 0.42, width * 0.42, 10, 22), rubber,
      );
      tyre.rotation.y = Math.PI / 2;
      tyre.castShadow = true;
      g.add(tyre);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, width * 0.72, 14), rimMat,
      );
      rim.rotation.z = Math.PI / 2;
      g.add(rim);
      // Spokes read as motion blur once it's spinning.
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, radius * 1.15, 0.022), rimMat);
        s.rotation.x = (i / 5) * Math.PI;
        g.add(s);
      }
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, 0.015, 16), metal,
      );
      disc.rotation.z = Math.PI / 2;
      disc.position.x = width * 0.5;
      g.add(disc);
      return g;
    };

    this.rearWheel = buildWheel(this.R, 0.17, gold);
    this.rearWheel.position.set(0, this.R, 0);
    this.bike.add(this.rearWheel);

    this.frontWheel = buildWheel(this.R, 0.14, gold);
    this.frontWheel.position.set(0, 0, 0);
    this.forkGroup.position.set(0, this.R, WB);
    this.forkGroup.add(this.frontWheel);
    this.bike.add(this.forkGroup);

    // ---- frame -----------------------------------------------------------
    const swingarm = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.52), black);
    swingarm.position.set(0, this.R + 0.02, 0.27);
    swingarm.castShadow = true;
    this.bike.add(swingarm);

    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.30, 0.34), engineMat);
    engine.position.set(0, 0.40, 0.50);
    engine.castShadow = true;
    this.bike.add(engine);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.20, 0.22), metal);
    head.position.set(0, 0.60, 0.54);
    this.bike.add(head);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.72), body);
    spine.position.set(0, 0.66, 0.62);
    spine.rotation.x = -0.08;
    spine.castShadow = true;
    this.bike.add(spine);

    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.24, 0.46), body);
    tank.position.set(0, 0.80, 0.72);
    tank.castShadow = true;
    this.bike.add(tank);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.11, 0.48), black);
    seat.position.set(0, 0.80, 0.34);
    seat.castShadow = true;
    this.bike.add(seat);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.30), body);
    tail.position.set(0, 0.80, 0.06);
    tail.castShadow = true;
    this.bike.add(tail);

    // Tail light + plate: this is what drags when you go too far.
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.20, 0.14, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xf0efe6, roughness: 0.8 }),
    );
    plate.position.set(0, 0.62, -0.10);
    plate.rotation.x = 0.3;
    this.bike.add(plate);

    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.62, 10), metal);
    exhaust.rotation.set(Math.PI / 2 - 0.12, 0, 0);
    exhaust.position.set(0.13, 0.34, 0.22);
    exhaust.castShadow = true;
    this.bike.add(exhaust);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.34, 12), black);
    can.rotation.set(Math.PI / 2 - 0.1, 0, 0);
    can.position.set(0.14, 0.42, -0.06);
    this.bike.add(can);

    // ---- front end -------------------------------------------------------
    // Modelled inside forkGroup so the whole assembly rakes as one.
    for (const dx of [-0.11, 0.11]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.66, 10), metal);
      leg.position.set(dx, 0.30, -0.055);
      leg.rotation.x = 0.42;
      leg.castShadow = true;
      this.forkGroup.add(leg);
    }
    const triple = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.14), black);
    triple.position.set(0, 0.62, -0.15);
    this.forkGroup.add(triple);

    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), black);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.70, -0.17);
    this.forkGroup.add(bar);
    for (const dx of [-0.29, 0.29]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 8), rubber);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(dx, 0.70, -0.17);
      this.forkGroup.add(grip);
    }

    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.17, 0.10), black);
    headlight.position.set(0, 0.60, -0.02);
    this.forkGroup.add(headlight);
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.12, 0.03),
      new THREE.MeshStandardMaterial({
        color: 0xfff3d0, emissive: 0xfff0c0, emissiveIntensity: 0.5, roughness: 0.2,
      }),
    );
    lens.position.set(0, 0.60, 0.04);
    this.forkGroup.add(lens);

    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.34), body);
    fender.position.set(0, 0.20, 0.02);
    fender.castShadow = true;
    this.forkGroup.add(fender);

    // Foot pegs.
    for (const dx of [-0.18, 0.18]) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 8), metal);
      peg.rotation.z = Math.PI / 2;
      peg.position.set(dx, 0.40, 0.62);
      this.bike.add(peg);
    }

    // ---- rider -----------------------------------------------------------
    this.forkOrigin.set(0, this.R, WB);
    this.gripLocal = [new THREE.Vector3(-0.29, 0.70, -0.17), new THREE.Vector3(0.29, 0.70, -0.17)];
    this.buildRider(opts.shirt ?? ['#1a1a1e', 'GOOD', 'BIKES', 'BETTER DAYS']);
    this.riderRoot.position.set(0, 0, RIDER_SEAT_Z);
    this.riderRoot.add(this.riderHips);
    this.riderHips.position.set(0, HIP_Y, 0);
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
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y - HIP_Y, z);
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
      new THREE.BoxGeometry(0.32, 0.46, 0.21),
      [shirtMat, shirtMat, shirtMat, shirtMat, shirtMat, shirtBack],
    );
    torso.position.copy(V(0, 1.14, 0));
    torso.castShadow = true;
    this.riderTorso.add(torso);

    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), shirtMat);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.copy(V(0, 1.34, 0.01));
    shoulders.castShadow = true;
    this.riderTorso.add(shoulders);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 8), skin);
    neck.position.copy(V(0, 1.42, 0.02));
    this.riderTorso.add(neck);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), helmetMat);
    helmet.position.copy(V(0, 1.53, 0.02));
    helmet.castShadow = true;
    this.riderTorso.add(helmet);
    const chinbar = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.11, 0.13), helmetMat);
    chinbar.position.copy(V(0, 1.47, 0.13));
    this.riderTorso.add(chinbar);
    const vis = new THREE.Mesh(new THREE.BoxGeometry(0.195, 0.10, 0.05), visor);
    vis.position.copy(V(0, 1.56, 0.13));
    this.riderTorso.add(vis);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.16), helmetMat);
    peak.position.copy(V(0, 1.63, 0.12));
    peak.rotation.x = -0.25;
    this.riderTorso.add(peak);
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, 0.45),
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
        upperLen: 0.30, lowerLen: 0.30,
        upperRadius: 0.052, lowerRadius: 0.044,
        upperMat: shirtMat, lowerMat: skin,
        endMat: skin, endRadius: 0.055,
        pole: new THREE.Vector3(side * 0.9, -0.35, -0.25),
        target: 'grip', side,
      }));
      this.limbs.push(makeChain({
        parent: this.riderTorso,
        root: V(side * 0.11, 0.94, 0.02),
        upperLen: 0.30, lowerLen: 0.28,
        upperRadius: 0.075, lowerRadius: 0.062,
        upperMat: denim, lowerMat: denim,
        endMat: shoe, endRadius: 0.06,
        pole: new THREE.Vector3(side * 0.8, -0.1, 0.9),
        target: 'peg', side,
      }));
    }

    this.riderHips.add(this.riderTorso);
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
    this.riderRoot.position.z = RIDER_SEAT_Z - back * 0.13 + fwd * 0.08;
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
        _v.set(limb.side * 0.18, 0.47, 0.62);
      }
      // Bike space -> riderRoot -> riderHips (== riderTorso, which has no
      // transform of its own).
      _v.z -= rootZ;
      _v.y -= HIP_Y;
      _v.applyQuaternion(hipsQuat);
      solveTwoBone(limb, _v);
    }
  }

  /** World-space point the camera should look at. */
  getFocusWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.focus.getWorldPosition(out);
  }
}
