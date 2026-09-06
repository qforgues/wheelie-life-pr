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
  private riderTorso = new THREE.Group();
  private riderArms: THREE.Group[] = [];
  private sparks: THREE.Points;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private wheelAngle = 0;
  private readonly R: number;

  constructor(tuning: BikeTuning, opts: BikeViewOptions = {}) {
    this.R = tuning.chassis.wheelRadius;
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
    this.buildRider(opts.shirt ?? ['#1a1a1e', 'GOOD', 'BIKES', 'BETTER DAYS']);
    this.riderRoot.position.set(0, 0, 0.34);
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

  /**
   * A capsule spanning two points. Hand-placing rotations for every limb was
   * producing arms that didn't reach the bars; this way the geometry is defined
   * by where the joints actually are.
   */
  private static limb(
    from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material,
  ): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = Math.max(0.02, dir.length());
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len - radius * 2, 4, 8), mat);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    // Capsules are built along +Y, so rotate that axis onto the limb.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.castShadow = true;
    return mesh;
  }

  private buildRider(shirt: [string, string, string, string]): void {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
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

    // Torso: the back panel carries the shirt print, like the cover art.
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.46, 0.21),
      [shirtMat, shirtMat, shirtMat, shirtMat, shirtMat, shirtBack],
    );
    torso.position.set(0, 1.14, 0);
    torso.castShadow = true;
    this.riderTorso.add(torso);

    // Shoulders, so the arms don't sprout out of a flat slab.
    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), shirtMat);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.set(0, 1.34, 0.01);
    shoulders.castShadow = true;
    this.riderTorso.add(shoulders);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 8), skin);
    neck.position.set(0, 1.42, 0.02);
    this.riderTorso.add(neck);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), helmetMat);
    helmet.position.set(0, 1.53, 0.02);
    helmet.castShadow = true;
    this.riderTorso.add(helmet);
    const chinbar = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.11, 0.13), helmetMat);
    chinbar.position.set(0, 1.47, 0.13);
    this.riderTorso.add(chinbar);
    const vis = new THREE.Mesh(new THREE.BoxGeometry(0.195, 0.10, 0.05), visor);
    vis.position.set(0, 1.56, 0.13);
    this.riderTorso.add(vis);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.16), helmetMat);
    peak.position.set(0, 1.63, 0.12);
    peak.rotation.x = -0.25;
    this.riderTorso.add(peak);
    // Crown decal on the back of the lid.
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xe9c750, roughness: 0.35, metalness: 0.5 }),
    );
    crown.position.copy(helmet.position);
    this.riderTorso.add(crown);

    // Arms: built to actually reach the grips. Grip world position is
    // (+-0.29, 0.94, 1.03); the rider group sits at z = 0.34.
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const shoulder = V(side * 0.17, 1.32, 0.03);
      arm.position.copy(shoulder);
      const grip = V(side * 0.29, 0.94 - 0.0, 1.03 - 0.34).sub(shoulder);
      const elbow = grip.clone().multiplyScalar(0.5).add(V(side * 0.09, 0.02, -0.06));
      arm.add(BikeView.limb(V(0, 0, 0), elbow, 0.052, shirtMat));
      arm.add(BikeView.limb(elbow, grip, 0.044, skin));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
      hand.position.copy(grip);
      arm.add(hand);
      this.riderArms.push(arm);
      this.riderTorso.add(arm);
    }

    // Legs: hip on the seat, knee out and forward, foot on the peg.
    for (const side of [-1, 1]) {
      const hip = V(side * 0.11, 0.94, 0.02);
      const knee = V(side * 0.21, 0.74, 0.36);
      const ankle = V(side * 0.18, 0.44, 0.26);
      this.riderTorso.add(BikeView.limb(hip, knee, 0.075, denim));
      this.riderTorso.add(BikeView.limb(knee, ankle, 0.062, denim));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.22), shoe);
      foot.position.set(side * 0.18, 0.41, 0.30);
      foot.castShadow = true;
      this.riderTorso.add(foot);
    }

    this.riderRoot.add(this.riderTorso);
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

    // Rider body english. This is the only visual read on weight shift, and it
    // needs to be legible from the chase camera: sit back and stand the arms up.
    const back = Math.max(0, weightShift) / 0.11;
    const fwd = Math.max(0, -weightShift) / 0.04;
    this.riderRoot.position.z = 0.34 - back * 0.16 + fwd * 0.10;
    this.riderTorso.rotation.x = -0.10 - back * 0.30 + fwd * 0.45 + state.pitch * 0.22;
    this.riderTorso.rotation.z = -state.roll * 0.55;
    for (const arm of this.riderArms) {
      arm.rotation.x = -back * 0.35 + fwd * 0.25;
    }

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

  /** World-space point the camera should look at. */
  getFocusWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.focus.getWorldPosition(out);
  }
}
