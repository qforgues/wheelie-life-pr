import * as THREE from 'three';
import { Loop } from '../core/Loop';
import { createRenderer, guardContext } from '../core/RenderGuard';
import { UpdateWatcher } from '../core/UpdateWatcher';
import { QualityGovernor, applyQuality, initialTier } from '../core/Quality';
import { InputManager } from '../input/InputManager';
import { BikeSim } from '../sim/BikeSim';
import { BIKES, TRICKS, cloneTuning, type BikeId } from '../sim/tuning';
import { BIKE_VISUALS } from '../view/bikeVisuals';
import { City } from '../world/City';
import { Police } from '../world/Police';
import { Rivals, type RivalReport } from '../world/Rivals';
import { Battle, challengeFor, offerFrom } from './Battle';
import { stakeValue, type Stake } from './Battles';
import { OUTFITS, type OutfitId } from './Outfits';
import { BattleCard } from '../ui/BattleCard';
import {
  Minimap, ORIENTATION_LABELS, ORIENTATION_ORDER, type MapBlip,
} from '../ui/Minimap';
import { Mirrors } from '../view/Mirrors';
import { buildSky, buildEnvironment, type SkyRig } from '../world/Sky';
import { makeBlobShadowTexture, setAnisotropy, setTextureScale } from '../world/textures';
import { BikeView } from '../view/BikeView';
import { CAMERA_LABELS } from '../view/ChaseCamera';
import { ChaseCamera } from '../view/ChaseCamera';
import { EngineAudio } from '../audio/EngineAudio';
import { Voice, pickCall } from '../audio/Voice';
import { VoicePack } from '../audio/VoicePack';
import { Hud } from '../ui/Hud';
import { ControlsOverlay } from '../ui/ControlsOverlay';
import { DebugPanel } from '../ui/DebugPanel';
import { Diagnostics } from '../ui/Diagnostics';
import { WheelieTracker } from './WheelieTracker';
import { Progress, money } from './Progress';
import { applyUpgrades, plateEffect, scannerMode } from './Upgrades';
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

/** Score multiplier while the police want you. */
const HOT_MULTIPLIER = 2;

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
  private voice = new Voice();
  private voicePack = new VoicePack(() => this.audio.context, () => this.audio.bus);
  private input = new InputManager();
  private hud = new Hud();
  private overlay: ControlsOverlay;
  private debug: DebugPanel;
  private diagnostics: Diagnostics;
  private lastFps = 0;
  private tracker = new WheelieTracker();
  private progress = new Progress();
  private loop: Loop;
  private quality: QualityGovernor;

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
  private lastTrick: string = 'none';
  /** null until the first frame, so the overlay always gets told once. */
  private padWasConnected: boolean | null = null;
  private bikeId: BikeId = 'yz250f';
  private headVec = new THREE.Vector3();
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  private contextLost = false;
  /** Fake contact shadow, shown only when real shadow mapping is off. */
  private blobShadow: THREE.Mesh;
  private police = new Police();
  private rivals = new Rivals();
  private battleCard = new BattleCard();
  /** The battle on the table or on the road. Null the rest of the time. */
  private battle: Battle | null = null;
  /** Stops the same rider re-opening the prompt the instant you decline. */
  private declined = new Map<number, number>();
  private minimap = new Minimap();
  private blips: MapBlip[] = [];
  private heat = 0;
  private sirenTimer = 0;
  private pursuit = 0;
  private reportedFaults = new Set<string>();
  private mirrors = new Mirrors();
  private updates = new UpdateWatcher(() => {
    this.overlay.showUpdate();
    this.hud.showUpdate();
  });

  constructor(container: HTMLElement) {
    // ---- renderer --------------------------------------------------------
    const tier = initialTier();
    // Throws rather than handing back a renderer that draws nothing; main.ts
    // turns that into a readable screen.
    // Textures are generated on first use below, so the filtering budget has to
    // be set before the city is built.
    setAnisotropy(tier === 'low' ? 2 : tier === 'medium' ? 4 : 16);
    // On the console the textures cost more than every vertex in the city put
    // together. Half size is a quarter of the memory and there is nothing to
    // see at a pixel ratio of 1 on a television.
    setTextureScale(tier === 'low' ? 0.5 : tier === 'medium' ? 0.75 : 1);
    this.renderer = createRenderer(tier !== 'low');
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // ---- world -----------------------------------------------------------
    this.city = new City(tier === 'low');
    this.scene.add(this.city.root);
    this.scene.add(this.police.root);
    this.scene.add(this.rivals.root);
    // Another rider is as solid as anything else in the road. You can split
    // past one - the box is bike-shaped, not car-shaped - but you cannot ride
    // through them.
    this.city.extraCollider = (x, z, r) => this.police.hits(x, z, r) || this.rivals.hits(x, z, r);
    // Patrols crash into the same things the player does - but not into each
    // other, and never into themselves.
    this.police.obstacleTest = (x, z, r) => this.city.blocked(x, z, r);
    this.sky = buildSky(this.scene, this.renderer);

    // ---- bike ------------------------------------------------------------
    // Justin's pick. The Grom is the free starter bike and stays in the
    // catalogue; switching is a one-line change until there's a garage screen.
    // Boot into whatever they last rode, which on a fresh save is the Grom -
    // the free starter the interview asked for.
    this.bikeId = this.progress.lastBike;
    const tuning = applyUpgrades(
      cloneTuning(BIKES[this.bikeId]), this.progress.levelsFor(this.bikeId),
    );
    this.sim = new BikeSim(tuning, this.city, this.city.spawn);
    this.bikeView = new BikeView(tuning, BIKE_VISUALS[this.bikeId], OUTFITS[this.progress.wearing]);
    this.scene.add(this.bikeView.root, this.bikeView.detached);

    // Sits just above the road, always flat, never rotating with the bike.
    this.blobShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: makeBlobShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      }),
    );
    this.blobShadow.rotation.x = -Math.PI / 2;
    this.blobShadow.renderOrder = -1;
    this.scene.add(this.blobShadow);

    // ---- camera ----------------------------------------------------------
    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.snapPose();
    this.bikeView.update(this.sim.state, 0, 0, 0);
    this.chase.snapTo(this.sim.state, this.bikeView.getFocusWorld(this.focusVec));

    // ---- ui --------------------------------------------------------------
    container.appendChild(this.hud.root);
    container.appendChild(this.minimap.root);
    container.appendChild(this.battleCard.root);
    this.battleCard.onDecided((yes) => this.decideBattle(yes));
    this.battleCard.onTermsChanged((stake, want) => this.reprice(stake, want));
    // Quality is picked from the device, then stepped down on its own if the
    // frame rate can't hold - the Xbox browser has a fraction of a desktop's
    // budget and it is better to lose shadows than to lose the frame rate.
    this.quality = new QualityGovernor(tier, (settings, t) => {
      applyQuality(settings, this.renderer, this.sky.sun, this.scene.fog as THREE.Fog);
      this.blobShadow.visible = !settings.shadows;
      this.hud.showToast(`GRAPHICS: ${t.toUpperCase()}`, 2);
    });
    applyQuality(this.quality.settings, this.renderer, this.sky.sun, this.scene.fog as THREE.Fog);
    this.blobShadow.visible = !this.quality.settings.shadows;
    this.mirrors.setSize(innerWidth, innerHeight);

    this.overlay = new ControlsOverlay(() => this.onRide());
    this.city.traffic.setSpeed(this.progress.traffic);
    this.overlay.setTrafficValue(this.progress.traffic);
    this.overlay.setMirrorValues(this.progress.mirrors, this.progress.mirrorAim);
    this.mirrors.setMount(this.progress.mirrors);
    this.mirrors.setAim(this.progress.mirrorAim);
    this.overlay.onMirrorsPicked((mnt) => {
      this.mirrors.setMount(mnt);
      this.progress.setMirrors(mnt);
    });
    this.overlay.onMirrorAim((aim) => {
      this.mirrors.setAim(aim);
      this.progress.setMirrorAim(aim);
    });

    this.overlay.setOrientationValue(this.progress.mapOrientation);
    this.minimap.root.hidden = this.progress.mapOrientation === 'off';
    this.overlay.onOrientationPicked((o) => {
      this.progress.setMapOrientation(o);
      this.minimap.root.hidden = o === 'off';
    });

    this.applyPlates();
    this.overlay.onOutfitPicked(() => this.rebuildRider());
    this.rivals.setCount(this.progress.rivals);
    this.overlay.setRivalsValue(this.progress.rivals);
    this.overlay.onRivalsPicked((r) => {
      this.rivals.setCount(r);
      this.progress.setRivals(r);
    });
    this.police.setStyle(this.progress.police);
    this.overlay.setPoliceValue(this.progress.police);
    this.overlay.onPolicePicked((style) => {
      this.police.setStyle(style);
      this.progress.setPolice(style);
      this.heat = 0;
      this.blips = [];
    });
    this.overlay.onTrafficPicked((t) => {
      this.city.traffic.setSpeed(t);
      this.progress.setTraffic(t);
    });
    container.appendChild(this.overlay.root);

    this.diagnostics = new Diagnostics(this.input, () => ({
      fps: this.lastFps,
      quality: this.quality.tier,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      audio: this.audio.status,
      voice: this.voicePack.count > 0
        ? `${this.voicePack.count} recorded clips`
        : (this.voice.available ? 'synthesised' : 'none'),
      bike: BIKES[this.bikeId].name,
    }));
    container.appendChild(this.diagnostics.root);
    this.debug = new DebugPanel(
      this.sim, this.chase, this.tracker, () => this.resetBike(), BIKES[this.bikeId],
      this.quality, this.bikeView, this.progress, () => this.overlay.renderGarage(),
    );
    this.overlay.attachProgress(this.progress, this.bikeId);
    this.overlay.onBikePicked((id) => this.setBike(id));
    this.overlay.onDiagnostics(() => this.diagnostics.toggle());
    this.overlay.onUpgradeBought(() => {
      this.hud.cash = this.progress.money;
      this.applyPlates();
      // Rebuild on the current bike so the new part is live immediately.
      this.applyTuning();
    });

    this.input.attach(this.renderer.domElement);
    // Start card up: let the console's own cursor drive it. See setGamepadEmulation.
    this.input.setGamepadEmulation('mouse');
    addEventListener('resize', () => this.onResize());

    // Both wrapped: a single throwing frame used to mean every subsequent frame
    // threw too, so nothing was ever drawn again and the screen simply went
    // white. Now the failure is reported once and the loop carries on.
    this.loop = new Loop(
      FIXED_STEP,
      (dt) => this.guard('update', () => this.fixedUpdate(dt)),
      (dt, alpha) => this.guard('render', () => this.render(dt, alpha)),
    );
  }

  start(): void {
    // Never reload underneath a wheelie. A new build raises a flag on the HUD
    // and the menu; installing it is always the player's decision.
    this.updates.start();

    // If the last run died, say so now rather than making anyone reproduce it.
    const lastCrash = Diagnostics.takeLastCrash();
    if (lastCrash) this.diagnostics.note(lastCrash);

    // A lost context leaves a live HUD over a blank canvas, which is exactly
    // how this failed on the Xbox. Stop the clock, say so on screen, and pick
    // back up if the browser gives the GPU back.
    guardContext(this.renderer, {
      onLost: () => {
        // The loop keeps running deliberately. Stopping it also stops the
        // diagnostics panel and the toast - the two things actually explaining
        // the failure - which is how this turned into a silent white screen in
        // the first place. Freeze the bike, skip the draw, keep the UI alive.
        this.contextLost = true;
        this.hud.showToast('GRAPHICS LOST - RECOVERING', 6);
      },
      onRestored: () => {
        buildEnvironment(this.scene, this.renderer);
        applyQuality(this.quality.settings, this.renderer, this.sky.sun, this.scene.fog as THREE.Fog);
        this.contextLost = false;
        this.hud.showToast('GRAPHICS RESTORED', 2);
      },
      note: (msg) => this.diagnostics.note(msg),
    });
    this.loop.start();
  }

  /**
   * Swap to another bike. Rebuilds the sim and the model, keeps the world, the
   * camera and the best distance. Called from the bike picker on the start card.
   */
  setBike(id: BikeId): void {
    if (id === this.bikeId) return;
    if (!this.progress.has(id)) return;   // can't ride what you haven't bought
    this.progress.setLastBike(id);
    this.bikeId = id;
    const tuning = applyUpgrades(cloneTuning(BIKES[id]), this.progress.levelsFor(id));

    this.scene.remove(this.bikeView.root, this.bikeView.detached);
    this.bikeView.dispose();
    this.bikeView = new BikeView(tuning, BIKE_VISUALS[id], OUTFITS[this.progress.wearing]);
    this.scene.add(this.bikeView.root, this.bikeView.detached);

    const at = this.city.respawnFor(this.sim.state.x, this.sim.state.z);
    this.sim = new BikeSim(tuning, this.city, at);
    this.sim.reset(at);
    this.debug.rebind(this.sim, BIKES[id], this.bikeView);
    this.tracker.endRun(false);

    this.snapPose();
    this.bikeView.update(this.sim.state, 0, 0, 0);
    this.chase.snapTo(this.sim.state, this.bikeView.getFocusWorld(this.focusVec));
    this.hud.showToast(BIKES[id].name.toUpperCase(), 2.2);
  }

  /** Puts the current outfit back on the rider without touching the bike. */
  private rebuildRider(): void {
    const tuning = applyUpgrades(cloneTuning(BIKES[this.bikeId]), this.progress.levelsFor(this.bikeId));
    this.scene.remove(this.bikeView.root, this.bikeView.detached);
    this.bikeView.dispose();
    this.bikeView = new BikeView(
      tuning, BIKE_VISUALS[this.bikeId], OUTFITS[this.progress.wearing],
    );
    this.scene.add(this.bikeView.root, this.bikeView.detached);
    this.debug.rebind(this.sim, BIKES[this.bikeId], this.bikeView);
    this.snapPose();
    this.bikeView.update(this.sim.state, 0, 0, 0);
    this.chase.snapTo(this.sim.state, this.bikeView.getFocusWorld(this.focusVec));
  }

  /**
   * How good the player is at this, 0..1, for pricing a wager.
   *
   * Their best run this session against a hundred metres, nudged by the bike
   * they are on and the aura they are carrying. It has to be an honest estimate
   * or the broker's fairness is fair about the wrong thing - and it has to move
   * as the player improves, or every bet is priced off their first week.
   */
  private playerSkill(): number {
    const form = Math.min(1, this.progress.bestScore / 140);
    const machine = this.bikeId === 'streetfighter' ? 0.16 : this.bikeId === 'yz250f' ? 0.10 : 0;
    const rep = Math.min(0.12, this.progress.aura * 0.012);
    return Math.max(0.05, Math.min(0.95, 0.22 + form * 0.5 + machine + rep));
  }

  /** What a rival could be made to put up. */
  private rivalOutfits(kit: OutfitId | null): OutfitId[] {
    return kit ? [kit] : [];
  }

  /** Somebody rode into you. Put the offer on the table. */
  private openBattle(contact: { index: number; name: string; skill: number; wearing: OutfitId | null }): void {
    const until = this.declined.get(contact.index) ?? 0;
    if (performance.now() < until) return;
    this.battleCard.open(this.progress.money, this.progress.aura);
    const id = challengeFor(contact.index, Math.floor(performance.now() / 1000));
    this.battle = offerFrom(
      contact.index, contact.name, id,
      this.playerSkill(), contact.skill,
      this.battleCard.currentStake, null,
      this.rivalOutfits(contact.wearing), 40000,
    );
    this.battleCard.showOffer(
      this.battle, this.progress.money, this.progress.aura,
      this.rivalOutfits(contact.wearing),
    );
    this.audio.siren(40, 0.2);
  }

  /** The player moved a chip. Ask the broker again. */
  private reprice(stake: Stake, want: Stake | null): void {
    const b = this.battle;
    if (!b || b.phase !== 'offer') return;
    const rider = this.rivals.specFor(b.rival);
    if (!rider) return;
    const kits = this.rivalOutfits(rider.wearing);
    this.battle = offerFrom(
      b.rival, b.rivalName, b.terms.challenge.id,
      this.playerSkill(), rider.skill,
      stake, want, kits, 40000,
    );
    this.battleCard.showOffer(this.battle, this.progress.money, this.progress.aura, kits);
  }

  private decideBattle(yes: boolean): void {
    const b = this.battle;
    if (!b) return;
    if (!yes) {
      // Give them a minute before they ask again, or riding away past somebody
      // reopens the prompt every time you touch a bar end.
      this.declined.set(b.rival, performance.now() + 60000);
      this.battle = null;
      this.battleCard.hide();
      return;
    }
    b.accept();
    this.rivals.battling = true;
    this.rivals.race(b.rival, true);
    this.battleCard.showLive(b);
    this.voice.say('¡Vamo\' a ver!', 'es');
  }

  /**
   * Drives a battle that is on the table or on the road.
   *
   * The player's live wheelie comes off the tracker, which is the same number
   * the HUD shows - so the scoreboard and the distance counter can never
   * disagree, and neither can the payout.
   */
  private stepBattle(dt: number, st: BikeState, rivals: RivalReport): void {
    const b = this.battle;
    if (!b) return;
    if (b.phase === 'offer') return;

    const them = this.rivals.riderState(b.rival);
    b.update(
      dt,
      this.tracker.active ? this.tracker.current.distance : 0,
      !st.wheelieing,
      them?.up ?? false,
      them?.run ?? 0,
    );
    // Binning it ends it. You cannot lie on the road for forty seconds and
    // still be in a wheelie contest.
    if (b.running && st.mode === 'crashed') b.finish();
    if (b.phase === 'result' && !b.settled) {
      b.settled = true;
      this.rivals.endRace();
      this.rivals.race(b.rival, false);
      this.settleBattle(b);
    }
    this.battleCard.showLive(b);
    if (b.spent) {
      this.battle = null;
      this.battleCard.hide();
      this.declined.set(b.rival, performance.now() + 45000);
    }
    void rivals;
  }

  /** Pays out, moves the gear, and books the aura. */
  private settleBattle(b: Battle): void {
    const o = b.outcome;
    if (!o) return;
    const mine = b.terms.yours;
    const theirs = b.terms.theirs;

    if (o.won) {
      if (theirs.kind === 'cash') { o.cash = Math.round(theirs.amount); }
      else if (theirs.kind === 'outfit') {
        o.gained = theirs.outfit;
        this.progress.winOutfit(theirs.outfit);
      } else o.cash = Math.round(stakeValue(theirs));
    } else {
      if (mine.kind === 'cash') { o.cash = -Math.round(mine.amount); }
      else if (mine.kind === 'outfit') {
        o.lost = mine.outfit;
        this.progress.loseOutfit(mine.outfit);
      }
      // An aura stake is settled by the aura delta below, not by cash.
    }
    if (o.cash) this.progress.settleCash(o.cash);
    let aura = o.aura;
    if (!o.won && mine.kind === 'aura') aura -= mine.amount;
    if (o.won && theirs.kind === 'aura') aura += theirs.amount;
    this.progress.settleBattle(o.won, aura);
    o.aura = aura;
    this.hud.cash = this.progress.money;
    this.overlay.renderGarage();
    if (o.gained) this.hud.showToast(`${OUTFITS[o.gained].name.toUpperCase()} — WON, NOT BOUGHT`, 4);
    this.voice.say(o.won ? '¡Eso es!' : 'Otra vez será.', 'es');
  }

  /**
   * Runs a frame stage, reporting the first failure and swallowing repeats.
   *
   * Repeats are swallowed deliberately: a fault in the physics tends to happen
   * every single frame, and a hundred identical lines is worse than one.
   */
  private guard(stage: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const msg = `${stage}: ${err instanceof Error ? err.message : String(err)}`;
      if (this.reportedFaults.has(msg)) return;
      this.reportedFaults.add(msg);
      console.error(err);
      this.diagnostics.note(msg);
    }
  }

  private onResize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.mirrors.setSize(innerWidth, innerHeight);
    this.chase.setAspect(innerWidth / innerHeight);
  }

  // ------------------------------------------------------------------ update

  private fixedUpdate(dt: number): void {
    this.city.update(dt, this.sim.state.x, this.sim.state.z);
    const frame = this.input.update();

    // Any real input dismisses the card and unlocks audio (browsers need the
    // gesture) - no need to hunt for the button.
    if (this.overlay.isVisible && (frame.rider.throttle > 0.15 || frame.rider.shiftUp)) {
      this.overlay.hide();
      this.onRide();
    }
    if (frame.toggleHelp) {
      this.overlay.toggle();
      this.input.setGamepadEmulation(this.overlay.isVisible ? 'mouse' : 'gamepad');
    }
    if (frame.toggleDiagnostics) this.diagnostics.toggle();
    if (frame.cycleMap) {
      // G / D-pad down cycles the GPS. M was already mute, so the map took G.
      const order = ORIENTATION_ORDER;
      const next = order[(order.indexOf(this.progress.mapOrientation) + 1) % order.length];
      this.progress.setMapOrientation(next);
      this.overlay.setOrientationValue(next);
      this.minimap.root.hidden = next === 'off';
      this.hud.showToast(`GPS: ${ORIENTATION_LABELS[next]}`, 1.6);
    }
    if (frame.toggleDebug) this.debug.toggle();
    if (frame.toggleAudio) {
      this.audio.setMuted(!this.audio.isMuted);
      this.voice.enabled = !this.audio.isMuted;
      if (this.audio.isMuted) this.voice.stop();
      this.hud.showToast(this.audio.isMuted ? 'SOUND OFF' : 'SOUND ON', 1.2);
    }
    if (frame.padConnected !== this.padWasConnected) {
      this.padWasConnected = frame.padConnected;
      this.overlay.setDevice(frame.padConnected, frame.padName);
      if (frame.padConnected) this.hud.showToast(`${frame.padName} CONNECTED`, 2);
    }

    if (frame.cycleCamera) {
      const mode = this.chase.cycleMode();
      this.hud.showToast(`CAMERA: ${CAMERA_LABELS[mode]}`, 1.6);
    }
    if (frame.reset) this.resetBike();

    // La policía. Heat only climbs while the front wheel is up, so ordinary
    // riding is free and a long wheelie down a main road is a choice.
    const st = this.sim.state;
    const report = this.police.update(
      dt, st.x, st.z, st.wheelieing, st.mode === 'riding',
    );
    this.heat = report.heat;
    this.pursuit = this.progress.scannerLevel > 0 ? report.chasers : -1;
    if (report.warned) {
      this.hud.showToast('¡BÁJALA! — POLICE WARNING', 2.6);
      this.voice.say('¡Bájala, bájala!', 'es');
    }
    this.hud.setBustProgress(report.bustProgress);
    if (report.busted) this.onBusted();

    // A siren every few seconds while wanted, closer and more frantic as they
    // gain. The border tells you in the corner of your eye; this tells you when
    // your eyes are on the road.
    if (report.heat > 0 && report.chasers > 0) {
      this.sirenTimer -= dt;
      if (this.sirenTimer <= 0) {
        this.audio.siren(report.nearestChaser, Math.min(1, report.heat / 3));
        // Irregular on purpose - a metronome stops being information.
        this.sirenTimer = 2.6 - report.heat * 0.45 + Math.random() * 1.4;
      }
    } else {
      this.sirenTimer = 0;
    }
    // Los Piratas. They ride the same grid, they are up on the back wheel most
    // of the time, and coming alongside one gets you a shout.
    const rivals = this.rivals.update(dt, st.x, st.z);

    // A battle starts on contact - Justin's rule. The prompt only comes up when
    // there isn't one already on the table, you're actually riding, and you
    // haven't just told this rider no.
    if (rivals.contact && !this.battle && st.mode === 'riding' && !this.overlay.isVisible) {
      this.openBattle(rivals.contact);
    }
    if (this.battle) this.stepBattle(dt, st, rivals);

    if (rivals.hail && !this.battle) {
      this.hud.showToast(
        rivals.hail.wheelie > 5
          ? `${rivals.hail.name} — ${rivals.hail.wheelie.toFixed(0)} m AND COUNTING`
          : `${rivals.hail.name} — ${rivals.hail.line}`,
        2.2,
      );
      this.voice.say(rivals.hail.line, 'es');
    }

    // What the scanner shows depends on how much of one you own. Rivals are on
    // the map whatever you own: they are not hiding from you.
    const mode = scannerMode(this.progress.scannerLevel);
    this.blips = mode === 'none'
      ? []
      : report.blips
        .filter((b) => mode !== 'chasers' || b.chasing)
        .map((b) => ({
          x: b.x, z: b.z,
          kind: b.chasing ? ('cop' as const) : ('patrol' as const),
          // Level three adds which way each one is pointing.
          heading: mode === 'heading' ? b.yaw : undefined,
        }));
    for (const b of rivals.blips) this.blips.push({ x: b.x, z: b.z, kind: 'rival' });

    const state = this.sim.state;
    const blocked = this.overlay.isVisible;
    const rider = blocked
      ? { throttle: 0, brake: 0, steer: 0, weight: 0, shiftUp: false, shiftDown: false, trick: 'none' as const }
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
        // One line, shown and shouted, so the screen and the voice agree.
        const call = pickCall(state.crashReason);
        this.hud.crashCall = call;
        this.audio.crash();
        if (!this.audio.isMuted) {
          this.voice.call(state.crashReason ?? 'impact', call, 'es');
        }
        // Throw the rider off. The bike keeps sliding without them.
        this.bikeView.startCrash(state.lastImpact, state.roll, state.yaw);
        this.chase.bump(1.0 + Math.min(1, state.lastImpact / 18));
        this.input.rumble(0.95, 0.85, 380);
      }
      if (this.sim.crashTime > CRASH_HOLD) this.resetBike();
    }

    // Tricks multiply what the run banks while they're held.
    // Everything you ride while wanted counts double.
    //
    // This is what the police are FOR. Without it heat was pure downside - a
    // tax on doing the thing the game is about - so the right play was always
    // to keep it cool. Now a long wheelie down a main road with three cars
    // behind you is the best-paying thing in the game, and backing off is a
    // decision rather than the obvious answer. It stacks with tricks, because
    // standing on the seat while wanted should be exactly as reckless as it
    // sounds.
    const trickMult = TRICKS[state.trick].scoreMultiplier * state.trickBlend
      + (1 - state.trickBlend);
    const heatMult = this.heat > 0 ? HOT_MULTIPLIER : 1;
    this.tracker.update(state, dt, trickMult * heatMult);
    this.hud.setHotBonus(this.heat > 0 ? HOT_MULTIPLIER : 0);
    // A landed run pays. A crashed one already ended unbanked, so it can't.
    if (this.tracker.justEnded && this.tracker.lastBanked) {
      const paid = this.progress.bank(this.tracker.last.score);
      if (paid > 0) {
        this.hud.showToast(
          this.progress.lastWasRecord
            ? `NEW BEST · +${money(paid)}`
            : `+${money(paid)}`,
          this.progress.lastWasRecord ? 2.8 : 1.8,
        );
        this.overlay.renderGarage();
      }
    }
    if (state.trick !== this.lastTrick) {
      this.lastTrick = state.trick;
      if (state.trick !== 'none') this.hud.showToast(TRICKS[state.trick].label, 1.4);
    }
    if (this.tracker.justSetRecord && this.tracker.best.distance > 5) {
      this.audio.fanfare();
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

  /**
   * Pulled over. Costs a cut of the wallet and puts you back on the road.
   *
   * Deliberately not a game over: Justin's whole loop is "wreck and go again",
   * and a bust that ends the session would be the one thing in this game that
   * stops you riding.
   */
  /** Pushes the rider's plate upgrade into the police. */
  private applyPlates(): void {
    const e = plateEffect(this.progress.levelOf(this.bikeId, 'plates'));
    this.police.plateGain = e.gain;
    this.police.plateCool = e.cool;
  }

  /** Re-applies the current bike's tuning after an upgrade, without a rebuild. */
  private applyTuning(): void {
    const tuning = applyUpgrades(
      cloneTuning(BIKES[this.bikeId]), this.progress.levelsFor(this.bikeId),
    );
    this.sim.setTuning(tuning);
  }

  private onBusted(): void {
    const fine = this.progress.fine();
    this.audio.handcuffs();
    this.audio.crash();
    this.hud.setBustProgress(0);
    this.hud.flashBusted();
    this.hud.showToast(fine > 0 ? `PULLED OVER — ${money(fine)} FINE` : 'PULLED OVER', 3);
    this.voice.say('Te agarraron.', 'es');
    this.hud.cash = this.progress.money;
    this.overlay.renderGarage();
    this.resetBike();
  }

  private resetBike(): void {
    if (this.tracker.active) this.tracker.endRun();
    const s = this.sim.state;
    this.sim.reset(this.city.respawnFor(s.x, s.z));
    this.rivals.clearAround(this.sim.state.x, this.sim.state.z);
    this.bikeView.endCrash();
    this.voice.stop();
    this.snapPose();
    this.bikeView.update(this.sim.state, 0, 0, 0);
    this.chase.snapTo(this.sim.state, this.bikeView.getFocusWorld(this.focusVec));
  }

  /**
   * Called the moment the player commits to riding.
   *
   * This is the one point where a real user gesture is guaranteed, so it is
   * where audio gets unlocked - and where the console switches from driving its
   * own cursor to handing the page raw controller input.
   */
  private onRide(): void {
    this.audio.start();
    // The context only exists once audio has started, so the pack loads here.
    this.voice.pack = this.voicePack;
    void this.voicePack.load();
    this.input.setGamepadEmulation('gamepad');
  }

  /** Collapse both poses onto the current state - after a teleport or reset,
   *  so the renderer never interpolates across the jump. */
  private snapPose(): void {
    readPose(this.sim.state, this.sim.wheelSpin, this.sim.weightShiftValue, this.currPose);
    Object.assign(this.prevPose, this.currPose);
  }

  // ------------------------------------------------------------------ render

  /**
   * Puts the fake shadow under the contact patches.
   *
   * It shrinks and slides back as the front wheel lifts, which is the whole
   * point: the shadow leaving the front tyre is the clearest read the player
   * gets on how far over they are when shadow mapping is off.
   */
  private placeBlobShadow(state: BikeState): void {
    const lift = Math.max(0, Math.min(1, state.pitch / 1.1));
    const len = 2.1 - lift * 1.1;
    const back = lift * 0.45;
    this.blobShadow.position.set(
      state.x - Math.sin(state.yaw) * back,
      0.015,
      state.z - Math.cos(state.yaw) * back,
    );
    this.blobShadow.rotation.z = -state.yaw;
    this.blobShadow.scale.set(0.95, len, 1);
    (this.blobShadow.material as THREE.MeshBasicMaterial).opacity = 0.9 - lift * 0.25;
  }

  private render(dt: number, alpha: number): void {
    // No context, no draw - but the HUD and diagnostics are DOM and keep
    // updating below, so the screen still says what is wrong.
    if (this.contextLost) {
      this.diagnostics.update(dt, this.renderer);
      this.hud.update(this.sim.state, this.tracker, this.sim.getTuning(), dt);
      return;
    }
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

    const wasRagdolling = this.bikeView.isRagdolling;
    this.bikeView.update(state, wheelSpin, weightShift, dt);
    void wasRagdolling;
    this.bikeView.getFocusWorld(this.focusVec);
    this.chase.update(state, this.focusVec, dt, this.bikeView.getHeadWorld(this.headVec));

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

    this.quality.update(dt);
    this.lastFps = dt > 0 ? 1 / dt : 0;
    this.diagnostics.update(dt, this.renderer);
    this.hud.cash = this.progress.money;
    this.hud.update(state, this.tracker, this.sim.getTuning(), dt);
    this.debug.update(dt);
    this.audio.resumeIfNeeded();

    if (this.blobShadow.visible) this.placeBlobShadow(state);
    this.minimap.draw(
      state.x, state.z, state.yaw, this.blips, this.heat, this.progress.mapOrientation,
      this.pursuit,
    );
    this.mirrors.setFirstPerson(this.chase.mode === 'first');
    this.mirrors.place(state.x, state.y, state.z, state.yaw);
    this.renderer.render(this.scene, this.chase.camera);
    this.mirrors.render(this.renderer, this.scene);
  }
}

function emptyPose(): Pose {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, wheelSpin: 0, weightShift: 0 };
}
