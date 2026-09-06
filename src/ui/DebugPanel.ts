import GUI from 'lil-gui';
import type { BikeSim } from '../sim/BikeSim';
import type { BikeTuning } from '../sim/tuning';
import { GROM, cloneTuning } from '../sim/tuning';
import type { ChaseCamera } from '../view/ChaseCamera';
import type { WheelieTracker } from '../game/WheelieTracker';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Tuning panel. Everything that defines how the bike feels is reachable from
 * here and applies live, because the only way to find the right wheelie feel is
 * to ride it, nudge a number, and ride it again.
 *
 * "Copy tuning JSON" prints the current numbers so a good setup can be pasted
 * straight back into sim/tuning.ts.
 */
export class DebugPanel {
  private gui: GUI;
  private readouts = {
    speedMph: '0',
    rpm: '0',
    gear: '1',
    pitch: '0°',
    balancePoint: '0°',
    balanceError: '0°',
    roll: '0°',
    rearSlip: '0%',
    wheelieNow: '0.0 m',
    best: '0.0 m',
    fps: '0',
    peakPower: '0 hp',
  };
  private degrees = {
    scrapePitch: 0,
    crashPitch: 0,
    rollCrashAngle: 0,
  };
  private visible = false;
  private frames = 0;
  private fpsTimer = 0;
  /** Folders that bind directly to the tuning object and must be rebuilt when
   *  a preset swaps that object out from under them. */
  private boundFolders: GUI[] = [];

  constructor(
    private sim: BikeSim,
    private camera: ChaseCamera,
    private tracker: WheelieTracker,
    private onReset: () => void,
  ) {
    this.gui = new GUI({ title: 'WHEELIE LIFE · TUNING', width: 320 });
    this.gui.domElement.classList.add('debug-gui');
    this.hide();

    const t = sim.getTuning();
    this.syncDegrees(t);

    this.buildReadouts();
    this.buildPresets();
    this.buildEngine(t);
    this.buildChassis(t);
    this.buildRider(t);
    this.buildBrakes(t);
    this.buildBalance(t);
    this.buildLimits(t);
    this.buildSteering(t);
    this.buildCamera();
    this.buildActions();
  }

  private buildReadouts(): void {
    const f = this.gui.addFolder('Live').open();
    for (const key of Object.keys(this.readouts) as Array<keyof typeof this.readouts>) {
      f.add(this.readouts, key).disable().listen();
    }
  }

  private buildPresets(): void {
    const f = this.gui.addFolder('Presets').open();
    const presets = {
      'Chill (learning)': () => this.applyPreset('chill'),
      'Real (default)': () => this.applyPreset('real'),
      'Stunt (silly power)': () => this.applyPreset('stunt'),
    };
    for (const [name, fn] of Object.entries(presets)) f.add({ [name]: fn }, name);
  }

  private applyPreset(kind: 'chill' | 'real' | 'stunt'): void {
    const t = cloneTuning(GROM);
    if (kind === 'chill') {
      // Wider save window, no side-to-side wobble, softer landings.
      t.balance.rollInstability = 0;
      t.balance.rollResponse = 14;
      t.chassis.pitchDamping = 78;
      t.limits.crashPitch = 88 * DEG;
      t.rider.yankGain = 1350;
    } else if (kind === 'stunt') {
      t.engine.peakTorque = 34;
      t.rider.yankGain = 1600;
      t.balance.rollInstability = 0.8;
      t.limits.crashPitch = 86 * DEG;
    }
    this.sim.setTuning(t);
    this.syncDegrees(t);
    this.rebuildControllers(t);
  }

  private buildEngine(t: BikeTuning): void {
    const f = this.track(this.gui.addFolder('Engine').close());
    f.add(t.engine, 'peakTorque', 6, 45, 0.5).name('peak torque (Nm)').onChange(this.push);
    f.add(t.engine, 'peakTorqueRpm', 3000, 9000, 100).name('peak torque rpm').onChange(this.push);
    f.add(t.engine, 'lowEndFullness', 0.2, 1, 0.01).name('bottom end').onChange(this.push);
    f.add(t.engine, 'topEndFullness', 0.2, 1, 0.01).name('top end').onChange(this.push);
    f.add(t.engine, 'redlineRpm', 5000, 14000, 100).name('redline').onChange(this.push);
    f.add(t.engine, 'limiterRpm', 5000, 15000, 100).name('limiter').onChange(this.push);
    f.add(t.engine, 'engineBrakeTorque', 0, 25, 0.5).name('engine braking').onChange(this.push);
  }

  private buildChassis(t: BikeTuning): void {
    const f = this.track(this.gui.addFolder('Chassis').close());
    f.add(t.chassis, 'mass', 90, 300, 1).name('mass bike+rider (kg)').onChange(this.push);
    f.add(t.chassis, 'cgHeight', 0.3, 1.0, 0.01).name('CG height (m)').onChange(this.push);
    f.add(t.chassis, 'cgToRear', 0.25, 0.95, 0.005).name('CG fwd of rear (m)').onChange(this.push);
    f.add(t.chassis, 'pitchInertia', 8, 120, 1).name('pitch inertia').onChange(this.push);
    f.add(t.chassis, 'pitchDamping', 0, 220, 1).name('pitch damping').onChange(this.push);
    f.add(t.chassis, 'groundedPitchDamping', 20, 500, 5).name('damping (wheels down)').onChange(this.push);
    f.add(t.chassis, 'frontSlamRestitution', 0, 0.8, 0.01).name('front slam bounce').onChange(this.push);
    f.add(t.chassis, 'bumpAbsorption', 0, 1, 0.01).name('suspension absorbs').onChange(this.push);
    f.add(t.chassis, 'maxBumpKick', 0, 6, 0.1).name('max bump kick').onChange(this.push);
  }

  private buildRider(t: BikeTuning): void {
    const f = this.track(this.gui.addFolder('Rider').close());
    f.add(t.rider, 'weightShiftRange', 0, 0.35, 0.005).name('weight shift (m)').onChange(this.push);
    f.add(t.rider, 'weightShiftRate', 0.1, 3, 0.05).name('body speed (m/s)').onChange(this.push);
    f.add(t.rider, 'yankGain', 0, 3000, 25).name('yank strength').onChange(this.push);
  }

  private buildBrakes(t: BikeTuning): void {
    const f = this.track(this.gui.addFolder('Brakes').close());
    f.add(t.brakes, 'rearMaxTorque', 50, 1200, 10).name('rear torque (Nm)').onChange(this.push);
    f.add(t.brakes, 'frontMaxTorque', 100, 2500, 25).name('front torque (Nm)').onChange(this.push);
    f.add(t.brakes, 'rearBiasGrounded', 0, 1, 0.01).name('rear bias (wheels down)').onChange(this.push);
  }

  private buildBalance(t: BikeTuning): void {
    const f = this.track(this.gui.addFolder('Balance (side to side)').close());
    f.add(t.balance, 'rollInstability', 0, 1.5, 0.01).name('instability').onChange(this.push);
    f.add(t.balance, 'rollAuthority', 0, 8, 0.05).name('lean per stick').onChange(this.push);
    f.add(t.balance, 'rollResponse', 0, 10, 0.1).name('lean response').onChange(this.push);
    f.add(t.balance, 'rollDivergence', 0, 25, 0.5).name('tip-over force').onChange(this.push);
    f.add(t.balance, 'rollDamping', 0, 8, 0.05).name('self-centring').onChange(this.push);
    f.add(this.degrees, 'rollCrashAngle', 8, 80, 1).name('drop it at (deg)')
      .onChange((v: number) => { this.sim.getTuning().balance.rollCrashAngle = v * DEG; this.push(); });
  }

  private buildLimits(t: BikeTuning): void {
    void t;
    const f = this.track(this.gui.addFolder('Limits').close());
    f.add(this.degrees, 'scrapePitch', 20, 89, 1).name('tail scrapes at (deg)')
      .onChange((v: number) => { this.sim.getTuning().limits.scrapePitch = v * DEG; this.push(); });
    f.add(this.degrees, 'crashPitch', 30, 95, 1).name('loops out at (deg)')
      .onChange((v: number) => { this.sim.getTuning().limits.crashPitch = v * DEG; this.push(); });
  }

  private buildSteering(t: BikeTuning): void {
    const f = this.track(this.gui.addFolder('Steering & drag').close());
    f.add(t.steering, 'maxYawRateLow', 0.2, 4, 0.05).name('turn rate').onChange(this.push);
    f.add(t.steering, 'yawSpeedFalloff', 2, 30, 0.5).name('turn falloff').onChange(this.push);
    f.add(t.steering, 'wheelieSteerScale', 0, 1, 0.01).name('steer while up').onChange(this.push);
    f.add(t.aero, 'dragK', 0.05, 1.5, 0.01).name('aero drag').onChange(this.push);
    f.add(t.aero, 'rollingResistance', 0, 0.08, 0.001).name('rolling resistance').onChange(this.push);
    f.add(t.tyre, 'gripLong', 0.4, 2.2, 0.01).name('grip (drive)').onChange(this.push);
  }

  private buildCamera(): void {
    const f = this.gui.addFolder('Camera').close();
    const p = this.camera.params;
    f.add(p, 'distance', 2, 12, 0.1);
    f.add(p, 'height', 0.4, 6, 0.05);
    f.add(p, 'lateral', -3, 3, 0.05).name('side offset');
    f.add(p, 'wheelieLateral', -3, 3, 0.05).name('side offset on wheelie');
    f.add(p, 'wheelieDistance', 0, 5, 0.05).name('pull in on wheelie');
    f.add(p, 'wheelieDrop', 0, 3, 0.05).name('drop on wheelie');
    f.add(p, 'lookAhead', 0, 6, 0.05).name('look ahead');
    f.add(p, 'lookHeight', -1, 3, 0.05).name('look height');
    f.add(p, 'followSpeed', 1, 20, 0.1);
    f.add(p, 'speedFov', 0, 40, 1).name('speed FOV');
    f.add(p, 'autoCentre').name('auto re-centre');
  }

  private buildActions(): void {
    const f = this.gui.addFolder('Actions').open();
    f.add({ 'Reset bike (R)': () => this.onReset() }, 'Reset bike (R)');
    f.add({ 'Clear best': () => this.tracker.resetSession() }, 'Clear best');
    f.add({
      'Copy tuning JSON': () => {
        const json = JSON.stringify(this.sim.getTuning(), null, 2);
        void navigator.clipboard?.writeText(json);
        console.log('[wheelie-life] current tuning:\n' + json);
      },
    }, 'Copy tuning JSON');
    f.add({
      'Restore defaults': () => {
        const t = cloneTuning(GROM);
        this.sim.setTuning(t);
        this.syncDegrees(t);
        this.rebuildControllers(t);
      },
    }, 'Restore defaults');
  }

  /** lil-gui mutates the tuning object in place; this re-applies it to the sim. */
  private push = (): void => {
    this.sim.setTuning(this.sim.getTuning());
  };

  private syncDegrees(t: BikeTuning): void {
    this.degrees.scrapePitch = Math.round(t.limits.scrapePitch * RAD);
    this.degrees.crashPitch = Math.round(t.limits.crashPitch * RAD);
    this.degrees.rollCrashAngle = Math.round(t.balance.rollCrashAngle * RAD);
  }

  private track(folder: GUI): GUI {
    this.boundFolders.push(folder);
    return folder;
  }

  /** After a preset swap the folders point at the old object, so rebuild them. */
  private rebuildControllers(t: BikeTuning): void {
    for (const folder of this.boundFolders) folder.destroy();
    this.boundFolders = [];
    this.buildEngine(t);
    this.buildChassis(t);
    this.buildRider(t);
    this.buildBrakes(t);
    this.buildBalance(t);
    this.buildLimits(t);
    this.buildSteering(t);
  }

  update(dt: number): void {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.4) {
      this.readouts.fps = (this.frames / this.fpsTimer).toFixed(0);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    if (!this.visible) return;

    const s = this.sim.state;
    this.readouts.speedMph = (s.speed * 2.23694).toFixed(1);
    this.readouts.rpm = s.rpm.toFixed(0);
    this.readouts.gear = String(s.gear + 1);
    this.readouts.pitch = `${(s.pitch * RAD).toFixed(1)}°`;
    this.readouts.balancePoint = `${(s.balancePoint * RAD).toFixed(1)}°`;
    this.readouts.balanceError = `${(s.balanceError * RAD).toFixed(1)}°`;
    this.readouts.roll = `${(s.roll * RAD).toFixed(1)}°`;
    this.readouts.rearSlip = `${(s.wheelSlip * 100).toFixed(0)}%`;
    this.readouts.wheelieNow = `${this.tracker.current.distance.toFixed(1)} m`;
    this.readouts.best = `${this.tracker.best.distance.toFixed(1)} m`;
    this.readouts.peakPower = `${(this.sim.engine.peakPowerKw() * 1.34102).toFixed(1)} hp`;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    this.gui.domElement.style.display = '';
  }

  hide(): void {
    this.visible = false;
    this.gui.domElement.style.display = 'none';
  }
}
