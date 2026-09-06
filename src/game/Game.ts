import * as THREE from 'three';
import { Loop } from '../core/Loop';
import { InputManager } from '../input/InputManager';
import { BikeSim } from '../sim/BikeSim';
import { GROM, cloneTuning } from '../sim/tuning';
import { City } from '../world/City';
import { buildSky, type SkyRig } from '../world/Sky';
import { BikeView } from '../view/BikeView';
import { ChaseCamera } from '../view/ChaseCamera';
import { EngineAudio } from '../audio/EngineAudio';
import { Hud } from '../ui/Hud';
import { ControlsOverlay } from '../ui/ControlsOverlay';
import { DebugPanel } from '../ui/DebugPanel';
import { WheelieTracker } from './WheelieTracker';
import type { BikeState } from '../sim/types';

/** The handful of fields that need interpolating between physics steps. */
interface Pose {
  x: number; y: number; z: number;
  yaw: number; pitch: number; roll: number;
  speed: number; wheelSpin: number; weightShift: number;
}

function readPose(state: BikeState, wheelSpin: number, weightShift: number, out: Pose): Pose {
  out.x = state.x; out.y = state.y; out.z = state.z;
  out.yaw = state.yaw; out.pitch = state.pitch; out.roll = state.roll;
  out.speed = state.speed; out.wheelSpin = wheelSpin; out.weightShift = weightShift;
  return out;
}

function blend(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const FIXED_STEP = 1 / 120;
const CRASH_HOLD = 1.5;

/** Wires the sim, the world, the view, the audio and the UI together. */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private city: City;
  private sim: BikeSim;
  private bikeView: BikeView;
  private chase: ChaseCamera;
  private sky: SkyRig;
  private audio = new EngineAudio();
  private input = new InputManager();
  private hud = new Hud();
  private overlay: ControlsOverlay;
  private debug: DebugPanel;
  private tracker = new WheelieTracker();
  private loop: Loop;

  private focusVec = new THREE.Vector3();
  /**
   * Physics runs at a locked 120 Hz, the display runs at whatever it runs at,
   * so the number of sim steps per rendered frame alternates (1, 2, 1, 2...).
   * Drawing the last completed step makes the bike advance in uneven jumps -
   * judder that gets worse the faster you go. These two poses let the renderer
   * interpolate between the last two steps instead.
   */
  private prevPose: Pose = emptyPose();
  private currPose: Pose = emptyPose();
  private renderState = {} as BikeState;
  private hapticTimer = 0;
  private wasWheelieing = false;
  /** null until the first frame, so the overlay always gets told once. */
  private padWasConnected: boolean | null = null;

  constructor(container: HTMLElement) {
    // ---- renderer --------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // ---- world -----------------------------------------------------------
    this.city = new City();
    this.scene.add(this.city.root);
    this.sky = buildSky(this.scene, this.renderer);

    // ---- bike ------------------------------------------------------------
    const tuning = cloneTuning(GROM);
    this.sim = new BikeSim(tuning, this.city, this.city.spawn);
    this.bikeView = new BikeView(tuning, {
      bodyColor: 0x1f5fd0,
      shirt: ['#efe9dc', 'GOOD', 'BIKES', 'BETTER DAYS'],
    });
    this.scene.add(this.bikeView.root);

    // ---- camera ----------------------------------------------------------
    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.snapPose();
    this.bikeView.update(this.sim.state, 0, 0, 0);
    this.chase.snapTo(this.sim.state, this.bikeView.getFocusWorld(this.focusVec));

    // ---- ui --------------------------------------------------------------
    container.appendChild(this.hud.root);
    this.overlay = new ControlsOverlay(() => this.audio.start());
    container.appendChild(this.overlay.root);
    this.debug = new DebugPanel(this.sim, this.chase, this.tracker, () => this.resetBike());

    this.input.attach(this.renderer.domElement);
    addEventListener('resize', () => this.onResize());

    this.loop = new Loop(
      FIXED_STEP,
      (dt) => this.fixedUpdate(dt),
      (dt, alpha) => this.render(dt, alpha),
    );
  }

  start(): void {
    this.loop.start();
  }

  private onResize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.chase.setAspect(innerWidth / innerHeight);
  }

  // ------------------------------------------------------------------ update

  private fixedUpdate(dt: number): void {
    const frame = this.input.update();

    // Any real input dismisses the card and unlocks audio (browsers need the
    // gesture) - no need to hunt for the button.
    if (this.overlay.isVisible && (frame.rider.throttle > 0.15 || frame.rider.shiftUp)) {
      this.overlay.hide();
    }
    if (frame.toggleHelp) this.overlay.toggle();
    if (frame.toggleDebug) this.debug.toggle();
    if (frame.toggleAudio) {
      this.audio.setMuted(!this.audio.isMuted);
      this.hud.showToast(this.audio.isMuted ? 'SOUND OFF' : 'SOUND ON', 1.2);
    }
    if (frame.padConnected !== this.padWasConnected) {
      this.padWasConnected = frame.padConnected;
      this.overlay.setDevice(frame.padConnected, frame.padName);
      if (frame.padConnected) this.hud.showToast(`${frame.padName} CONNECTED`, 2);
    }

    if (frame.reset) this.resetBike();

    const state = this.sim.state;
    const blocked = this.overlay.isVisible;
    const rider = blocked
      ? { throttle: 0, brake: 0, steer: 0, weight: 0, shiftUp: false, shiftDown: false }
      : frame.rider;

    const gearBefore = state.gear;
    // Last step's pose becomes the one we interpolate *from*.
    readPose(state, this.sim.wheelSpin, this.sim.weightShiftValue, this.prevPose);
    this.sim.step(rider, dt);
    readPose(state, this.sim.wheelSpin, this.sim.weightShiftValue, this.currPose);
    if (state.gear !== gearBefore) this.audio.shiftBark();

    // Crash -> hold the wipeout for a beat, then drop back in.
    if (state.mode === 'crashed') {
      // Fell out of it - the distance shows, but it doesn't count.
      if (this.tracker.active) this.tracker.endRun(false);
      if (this.sim.crashTime < dt * 1.5) {
        this.audio.crash();
        this.chase.bump(1.0 + Math.min(1, state.lastImpact / 18));
        this.input.rumble(0.95, 0.85, 380);
      }
      if (this.sim.crashTime > CRASH_HOLD) this.resetBike();
    }

    this.tracker.update(state, dt);
    if (this.tracker.justSetRecord && this.tracker.best.distance > 5) {
      this.audio.fanfare();
      this.hud.showToast(`NEW BEST · ${this.tracker.best.distance.toFixed(1)} m`, 2.8);
    }

    this.audio.update(state, rider.throttle, this.sim.getTuning());
    this.updateHaptics(state, dt);

    this.chase.orbit(frame.cameraX, frame.cameraY, dt);
  }

  /**
   * Haptics carry the balance information the HUD deliberately doesn't:
   * a soft pulse near the balance point, a hard buzz once the tail is dragging.
   */
  private updateHaptics(state: import('../sim/types').BikeState, dt: number): void {
    this.hapticTimer -= dt;
    if (this.hapticTimer > 0 || state.mode !== 'riding') return;
    this.hapticTimer = 0.1;

    if (state.scraping) {
      this.input.rumble(0.75, 0.55, 130);
      return;
    }
    if (state.wheelieing) {
      // Tightest around the balance point, so "the pad goes quiet" means
      // "you've found it".
      const err = Math.abs(state.balanceError);
      const closeness = Math.max(0, 1 - err / 0.35);
      const wobble = Math.min(1, Math.abs(state.roll) / 0.35);
      const weak = 0.08 + closeness * 0.22 + wobble * 0.5;
      this.input.rumble(wobble * 0.45, weak, 130);
      return;
    }
    if (state.wheelSlip > this.sim.getTuning().tyre.spinThreshold) {
      this.input.rumble(0.2, 0.35, 120);
    }
  }

  private resetBike(): void {
    if (this.tracker.active) this.tracker.endRun();
    const s = this.sim.state;
    this.sim.reset(this.city.respawnFor(s.x, s.z));
    this.snapPose();
    this.bikeView.update(this.sim.state, 0, 0, 0);
    this.chase.snapTo(this.sim.state, this.bikeView.getFocusWorld(this.focusVec));
  }

  /** Collapse both poses onto the current state - after a teleport or reset,
   *  so the renderer never interpolates across the jump. */
  private snapPose(): void {
    readPose(this.sim.state, this.sim.wheelSpin, this.sim.weightShiftValue, this.currPose);
    Object.assign(this.prevPose, this.currPose);
  }

  // ------------------------------------------------------------------ render

  private render(dt: number, alpha: number): void {
    const simState = this.sim.state;

    // Draw between the last two physics steps rather than on top of the most
    // recent one. Everything not interpolated (gear, rpm, flags) is copied
    // straight through - only the pose is smoothed.
    const state = Object.assign(this.renderState, simState) as BikeState;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const p = this.prevPose;
    const c = this.currPose;
    state.x = blend(p.x, c.x, a);
    state.y = blend(p.y, c.y, a);
    state.z = blend(p.z, c.z, a);
    state.yaw = blend(p.yaw, c.yaw, a);
    state.pitch = blend(p.pitch, c.pitch, a);
    state.roll = blend(p.roll, c.roll, a);
    state.speed = blend(p.speed, c.speed, a);
    const wheelSpin = blend(p.wheelSpin, c.wheelSpin, a);
    const weightShift = blend(p.weightShift, c.weightShift, a);

    this.bikeView.update(state, wheelSpin, weightShift, dt);
    this.bikeView.getFocusWorld(this.focusVec);
    this.chase.update(state, this.focusVec, dt);

    // Keep the shadow frustum tight around the player instead of the whole city.
    // Sun sits behind and to the left of the default direction of travel, so the
    // face of the bike the chase camera sees is lit rather than silhouetted.
    this.sky.sun.position.set(state.x - 48, 150, state.z - 38);
    this.sky.sun.target.position.set(state.x, 0, state.z);
    this.sky.sun.target.updateMatrixWorld();
    this.sky.group.position.set(state.x, 0, 0);
    this.sky.update(dt);

    // A one-frame audible/visual cue when the front comes up.
    if (state.wheelieing && !this.wasWheelieing) {
      this.input.rumble(0.5, 0.3, 120);
    }
    this.wasWheelieing = state.wheelieing;

    this.hud.update(state, this.tracker, this.sim.getTuning(), dt);
    this.debug.update(dt);
    this.audio.resumeIfNeeded();

    this.renderer.render(this.scene, this.chase.camera);
  }
}

function emptyPose(): Pose {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, wheelSpin: 0, weightShift: 0 };
}
