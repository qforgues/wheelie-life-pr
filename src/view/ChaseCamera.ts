import * as THREE from 'three';
import type { BikeState } from '../sim/types';
import { damp } from '../sim/Engine';

/**
 * Chase camera tuned for wheelies specifically: it drops and pulls back as the
 * front comes up so the bike stays framed against the horizon. That horizon line
 * is the player's main balance cue, so it is never allowed to leave the frame.
 */
/**
 * Camera presets. Justin asked for "a camera button where I can change the view
 * to first person and different angles", with third-person behind the bike as
 * the one it starts on.
 */
export type CameraMode = 'chase' | 'close' | 'first' | 'wide';

export const CAMERA_MODES: CameraMode[] = ['chase', 'close', 'first', 'wide'];

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'CHASE',
  close: 'CLOSE',
  first: 'FIRST PERSON',
  wide: 'WIDE',
};

interface ModePreset {
  distance: number;
  height: number;
  lateral: number;
  wheelieDistance: number;
  wheelieDrop: number;
  wheelieLateral: number;
  lookAhead: number;
  lookHeight: number;
  fov: number;
  speedFov: number;
}

const PRESETS: Record<CameraMode, ModePreset> = {
  chase: {
    distance: 4.3, height: 1.35, lateral: 0.55,
    wheelieDistance: 0.35, wheelieDrop: 0.65, wheelieLateral: 0.8,
    lookAhead: 0.5, lookHeight: 0.35, fov: 52, speedFov: 10,
  },
  close: {
    distance: 2.7, height: 1.15, lateral: 0.42,
    wheelieDistance: 0.2, wheelieDrop: 0.5, wheelieLateral: 0.7,
    lookAhead: 0.4, lookHeight: 0.4, fov: 56, speedFov: 12,
  },
  first: {
    // Sits on the rider's head; distance and lateral are unused in this mode.
    distance: 0, height: 0, lateral: 0,
    wheelieDistance: 0, wheelieDrop: 0, wheelieLateral: 0,
    lookAhead: 6, lookHeight: 0, fov: 74, speedFov: 8,
  },
  wide: {
    distance: 7.4, height: 2.4, lateral: 1.5,
    wheelieDistance: 0.6, wheelieDrop: 1.0, wheelieLateral: 1.2,
    lookAhead: 1.2, lookHeight: 0.5, fov: 48, speedFov: 8,
  },
};

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** Orbit offsets driven by the right stick, in radians. */
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbitIdle = 0;

  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private shake = 0;
  private fov = 52;
  mode: CameraMode = 'chase';

  // Tunables, exposed to the debug panel.
  params = {
    distance: 4.3,
    height: 1.35,
    // Sit off to one side. From dead astern a wheelie is invisible - the
    // silhouette barely changes - so the camera has to see some profile.
    lateral: 0.55,
    wheelieLateral: 0.8,
    // Drop low and stay put when the front comes up, so the bike is silhouetted
    // against the sky. The horizon is the balance cue - it has to be readable.
    wheelieDistance: 0.35,
    wheelieDrop: 0.65,
    followSpeed: 6.5,
    lookSpeed: 9.0,
    lookAhead: 0.5,
    lookAheadSpeed: 0.025,
    lookHeight: 0.35,
    speedFov: 10,
    autoCentre: true,
  };

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.15, 2600);
    this.camera.position.set(0, 3, -6);
  }

  /** Applies a mode's preset to the live params. */
  setMode(mode: CameraMode): void {
    this.mode = mode;
    const p = PRESETS[mode];
    this.params.distance = p.distance;
    this.params.height = p.height;
    this.params.lateral = p.lateral;
    this.params.wheelieDistance = p.wheelieDistance;
    this.params.wheelieDrop = p.wheelieDrop;
    this.params.wheelieLateral = p.wheelieLateral;
    this.params.lookAhead = p.lookAhead;
    this.params.lookHeight = p.lookHeight;
    this.params.speedFov = p.speedFov;
    this.fov = p.fov;
  }

  /** Next mode in the cycle. Returns the one now active. */
  cycleMode(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    const next = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.setMode(next);
    return next;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Right stick / mouse drag. */
  orbit(dx: number, dy: number, dt: number): void {
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) this.orbitIdle = 0;
    else this.orbitIdle += dt;
    this.orbitYaw = clampAngle(this.orbitYaw - dx * 1.8 * dt);
    this.orbitPitch = clamp(this.orbitPitch - dy * 1.1 * dt, -0.5, 0.95);
    // Drift back behind the bike once the player lets go.
    if (this.params.autoCentre && this.orbitIdle > 1.1) {
      this.orbitYaw = damp(this.orbitYaw, 0, 2.2, dt);
      this.orbitPitch = damp(this.orbitPitch, 0, 2.2, dt);
    }
  }

  bump(strength: number): void {
    this.shake = Math.min(1.4, this.shake + strength);
  }

  update(state: BikeState, focus: THREE.Vector3, dt: number, head?: THREE.Vector3): void {
    const p = this.params;

    if (this.mode === 'first') {
      this.updateFirstPerson(state, head ?? focus, dt);
      return;
    }


    // Frame for the wheelie: closer and lower, so the nose rises into the sky.
    const wheelieMix = clamp(state.pitch / 0.9, 0, 1);
    const dist = p.distance - p.wheelieDistance * wheelieMix;
    const height = p.height - p.wheelieDrop * wheelieMix;

    const yaw = state.yaw + this.orbitYaw;
    const pitchOff = this.orbitPitch;

    // Swing further out to the side as the front comes up, which is what makes
    // the angle of the bike readable at a glance.
    const side = p.lateral + p.wheelieLateral * wheelieMix;
    const desired = new THREE.Vector3(
      focus.x - Math.sin(yaw) * dist * Math.cos(pitchOff) + Math.cos(yaw) * side,
      focus.y + height + Math.sin(pitchOff) * dist,
      focus.z - Math.cos(yaw) * dist * Math.cos(pitchOff) - Math.sin(yaw) * side,
    );
    // Never let the camera duck under the road.
    desired.y = Math.max(desired.y, state.y + 0.55);

    // Faster follow at speed so it doesn't lag into the buildings.
    const follow = p.followSpeed + state.speed * 0.16;
    this.pos.x = damp(this.pos.x, desired.x, follow, dt);
    this.pos.y = damp(this.pos.y, desired.y, follow * 1.25, dt);
    this.pos.z = damp(this.pos.z, desired.z, follow, dt);

    // Look just ahead of the bike, and higher when it's on the back wheel so the
    // nose stays framed instead of climbing out of shot.
    const ahead = p.lookAhead + state.speed * p.lookAheadSpeed;
    const lookAhead = new THREE.Vector3(
      focus.x + Math.sin(state.yaw) * ahead,
      focus.y + p.lookHeight + wheelieMix * 0.55,
      focus.z + Math.cos(state.yaw) * ahead,
    );
    this.target.x = damp(this.target.x, lookAhead.x, p.lookSpeed, dt);
    this.target.y = damp(this.target.y, lookAhead.y, p.lookSpeed, dt);
    this.target.z = damp(this.target.z, lookAhead.z, p.lookSpeed, dt);

    // Crash and impact shake.
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 0.32;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * s,
      this.pos.y + (Math.random() - 0.5) * s,
      this.pos.z + (Math.random() - 0.5) * s,
    );
    this.camera.lookAt(this.target);

    // A touch of roll so the horizon tips with the bike. Subtle - too much and
    // you lose the horizon as a balance reference.
    this.camera.rotateZ(-state.roll * 0.22);

    // Speed FOV. Cheap, and it's most of why fast feels fast.
    const targetFov = this.fov + clamp(state.speed / 24, 0, 1) * this.params.speedFov;
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rides on the rider's head. The bike's own pitch and roll come through the
   * head position, so a wheelie genuinely tips the horizon - which makes this
   * the hardest mode to balance in, and the most convincing.
   */
  private updateFirstPerson(state: BikeState, head: THREE.Vector3, dt: number): void {
    // Sit still relative to the head rather than damping toward it, otherwise
    // the view lags the bike and the horizon reads wrong.
    this.pos.copy(head);
    this.camera.position.copy(this.pos);

    const yaw = state.yaw + this.orbitYaw;
    const ahead = this.params.lookAhead;
    // Look along the bike, tipped by its own pitch.
    const pitchLook = state.pitch * 0.85 - this.orbitPitch;
    this.target.set(
      head.x + Math.sin(yaw) * ahead * Math.cos(pitchLook),
      head.y + Math.sin(pitchLook) * ahead,
      head.z + Math.cos(yaw) * ahead * Math.cos(pitchLook),
    );
    this.camera.lookAt(this.target);
    this.camera.rotateZ(-state.roll);

    this.shake = Math.max(0, this.shake - dt * 2.2);
    const targetFov = this.fov + clamp(state.speed / 24, 0, 1) * this.params.speedFov;
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  snapTo(state: BikeState, focus: THREE.Vector3): void {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.shake = 0;
    this.pos.set(
      focus.x - Math.sin(state.yaw) * this.params.distance + Math.cos(state.yaw) * this.params.lateral,
      focus.y + this.params.height,
      focus.z - Math.cos(state.yaw) * this.params.distance - Math.sin(state.yaw) * this.params.lateral,
    );
    this.target.copy(focus);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function clampAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
