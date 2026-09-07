import type { BikeState } from '../sim/types';
import type { BikeTuning } from '../sim/tuning';

/**
 * Fully synthesised - no audio files. A single-cylinder four-stroke fires once
 * every two revolutions, so the fundamental is rpm/120 Hz; everything above that
 * is harmonics, intake roar and exhaust noise.
 *
 * Audio is doing real work here, not decoration. With no balance meter on screen
 * the engine note is how you hear the bike loading up, and the tail scrape is the
 * warning that you are about to loop it.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private started = false;
  private muted = false;

  private master!: GainNode;
  private engineGain!: GainNode;
  private lowpass!: BiquadFilterNode;
  private harmonics: Array<{ osc: OscillatorNode; gain: GainNode; mult: number }> = [];
  private intakeGain!: GainNode;
  private exhaustGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private scrubGain!: GainNode;
  private scrapeGain!: GainNode;
  private scrapeFilter!: BiquadFilterNode;
  private noiseBuffer!: AudioBuffer;

  volume = 0.75;

  /** Must be called from a user gesture; browsers block audio otherwise. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // Shared white-noise source, reused by intake, tyres, wind and scrape.
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // --- engine ------------------------------------------------------------
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 900;
    this.lowpass.Q.value = 1.2;
    this.engineGain.connect(this.lowpass);
    this.lowpass.connect(this.master);

    // Fundamental plus the harmonics that make a thumper sound like a thumper.
    for (const [mult, level] of [[1, 0.85], [2, 0.55], [3, 0.32], [4, 0.20], [6, 0.12], [8, 0.07]]) {
      const osc = ctx.createOscillator();
      osc.type = mult === 1 ? 'sawtooth' : 'square';
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain);
      gain.connect(this.engineGain);
      osc.start();
      this.harmonics.push({ osc, gain, mult });
    }

    // Exhaust bark: noise pushed through a resonant bandpass that tracks rpm.
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    const exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = 'bandpass';
    exhaustFilter.frequency.value = 320;
    exhaustFilter.Q.value = 2.4;
    this.noiseSource().connect(this.exhaustGain);
    this.exhaustGain.connect(exhaustFilter);
    exhaustFilter.connect(this.master);

    // Intake honk, opens up with throttle.
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.value = 1400;
    intakeFilter.Q.value = 1.1;
    this.noiseSource().connect(this.intakeGain);
    this.intakeGain.connect(intakeFilter);
    intakeFilter.connect(this.master);

    // --- wind --------------------------------------------------------------
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.noiseSource().connect(this.windGain);
    this.windGain.connect(this.windFilter);
    this.windFilter.connect(this.master);

    // --- tyre scrub --------------------------------------------------------
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    const scrubFilter = ctx.createBiquadFilter();
    scrubFilter.type = 'bandpass';
    scrubFilter.frequency.value = 2100;
    scrubFilter.Q.value = 3.5;
    this.noiseSource().connect(this.scrubGain);
    this.scrubGain.connect(scrubFilter);
    scrubFilter.connect(this.master);

    // --- tail scrape: your last warning before it goes over -----------------
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'bandpass';
    this.scrapeFilter.frequency.value = 3400;
    this.scrapeFilter.Q.value = 8;
    this.noiseSource().connect(this.scrapeGain);
    this.scrapeGain.connect(this.scrapeFilter);
    this.scrapeFilter.connect(this.master);
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.value = v;
  }

  update(state: BikeState, throttle: number, tuning: BikeTuning): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const k = 0.045; // smoothing time constant, keeps everything from zippering

    // Four-stroke single: one firing event every two revolutions.
    const fundamental = Math.max(12, state.rpm / 120);
    const load = 0.25 + throttle * 0.75;
    const rpmFrac = state.rpm / tuning.engine.limiterRpm;

    for (const h of this.harmonics) {
      h.osc.frequency.setTargetAtTime(fundamental * h.mult, t, k * 0.5);
    }

    // Cutting for the limiter chops the note - you can hear the ceiling.
    const cut = state.onLimiter ? 0.35 : 1;
    // Shifting drops the load instantly; that dip is the audible cue that the
    // nose is about to fall.
    const shiftDuck = state.shifting ? 0.28 : 1;

    this.engineGain.gain.setTargetAtTime(0.16 * load * cut * shiftDuck, t, k);
    this.lowpass.frequency.setTargetAtTime(
      420 + throttle * 2600 + rpmFrac * 1800, t, k,
    );

    this.exhaustGain.gain.setTargetAtTime(0.055 * load * cut * shiftDuck * (0.4 + rpmFrac), t, k);
    this.intakeGain.gain.setTargetAtTime(0.035 * throttle * (0.3 + rpmFrac * 0.9), t, k);

    const speedFrac = Math.min(1, state.speed / 28);
    this.windGain.gain.setTargetAtTime(0.05 * speedFrac * speedFrac, t, k);
    this.windFilter.frequency.setTargetAtTime(360 + speedFrac * 900, t, k);

    const spin = Math.max(0, state.wheelSlip - tuning.tyre.spinThreshold);
    this.scrubGain.gain.setTargetAtTime(Math.min(0.09, spin * 0.42), t, 0.02);

    // Scrape rises steeply as the tail comes down onto the road.
    const scrapeAmount = state.scraping
      ? Math.min(1, (state.pitch - tuning.limits.scrapePitch) /
          Math.max(0.05, tuning.limits.crashPitch - tuning.limits.scrapePitch))
      : 0;
    this.scrapeGain.gain.setTargetAtTime(scrapeAmount * 0.11, t, 0.03);
    this.scrapeFilter.frequency.setTargetAtTime(2400 + scrapeAmount * 2600, t, 0.05);
  }

  /** Clutchless upshift bark. */
  shiftBark(): void {
    if (!this.ctx || this.muted) return;
    this.blip(180, 0.06, 0.09);
  }

  /**
   * The wipeout: bike clattering down, then a body landing on top of it.
   *
   * Two separate sounds because they are two separate events. The clatter is
   * bright and metallic and starts immediately; the thud is low, soft-edged and
   * lands a beat later, which is what makes it read as a person rather than
   * more of the bike.
   */
  crash(): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Metal on cobbles.
    const clatter = ctx.createBufferSource();
    clatter.buffer = this.noiseBuffer;
    const cg = ctx.createGain();
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.setValueAtTime(3200, t);
    cf.frequency.exponentialRampToValueAtTime(420, t + 0.8);
    cf.Q.value = 1.1;
    cg.gain.setValueAtTime(0.34, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    clatter.connect(cf); cf.connect(cg); cg.connect(this.master);
    clatter.start(t);
    clatter.stop(t + 1.1);

    this.bodyThud(0.16);
  }

  /** A person hitting the road: low, dull, and over quickly. */
  /**
   * A siren somewhere behind you.
   *
   * The red border says you are wanted, but it lives in the corner of the
   * screen and a wheelie is not the moment you are looking at the corner of the
   * screen. This is the same information through an ear instead: the classic
   * two-tone wail, panned and attenuated by how close the nearest patrol is, so
   * it also tells you whether they are gaining.
   *
   * @param distance metres to the nearest chasing patrol.
   * @param urgency  0..1 - higher heat wails faster.
   */
  siren(distance: number, urgency = 0.5): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Falls off with distance and is gone by 260 m, which is where patrols
    // stop being drawn anyway.
    const near = Math.max(0, 1 - distance / 260);
    if (near <= 0.02) return;
    const level = 0.05 + near * near * 0.16;

    const wail = 1.1 - urgency * 0.45;          // seconds per sweep
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const lo = 620 + urgency * 90;
    const hi = 1080 + urgency * 180;
    osc.frequency.setValueAtTime(lo, t);
    osc.frequency.linearRampToValueAtTime(hi, t + wail * 0.5);
    osc.frequency.linearRampToValueAtTime(lo, t + wail);

    // Bandpass keeps it thin and distant rather than sitting on top of the
    // engine, which is the sound the player actually needs to hear.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 1.6;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.08);
    g.gain.setValueAtTime(level, t + wail - 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + wail);

    osc.connect(bp); bp.connect(g); g.connect(this.master);
    osc.start(t);
    osc.stop(t + wail + 0.05);
  }

  /**
   * Cuffs closing. The sound of the run being over.
   *
   * A ratchet is a burst of hard clicks with a rising pitch as the teeth pass,
   * then the double-click of it locking - which is why this is a short loop of
   * filtered noise pops rather than one hit.
   */
  handcuffs(): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const click = (at: number, freq: number, level: number, len = 0.028) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + at + len);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t0 + at);
      src.stop(t0 + at + len + 0.01);
    };

    // The ratchet: eight teeth, accelerating and rising.
    for (let i = 0; i < 8; i++) {
      const at = i * (0.030 - i * 0.0016);
      click(at, 2400 + i * 190, 0.30 - i * 0.012);
    }
    // Then the lock.
    click(0.30, 1500, 0.42, 0.05);
    click(0.38, 1150, 0.34, 0.06);
  }

  bodyThud(delay = 0): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;

    // The weight of it: a short pitch-dropping sine.
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.5, t + 0.012);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    osc.connect(og); og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.4);

    // The slap of clothing and gear on top of it.
    const slap = ctx.createBufferSource();
    slap.buffer = this.noiseBuffer;
    const sg = ctx.createGain();
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.setValueAtTime(1500, t);
    sf.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    sg.gain.setValueAtTime(0.3, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    slap.connect(sf); sf.connect(sg); sg.connect(this.master);
    slap.start(t);
    slap.stop(t + 0.3);
  }

  /** Short tone, used for shift barks and the personal-best chime. */
  blip(freq: number, duration: number, level: number, type: OscillatorType = 'square'): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g); g.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  /** Ascending three-note sting when a personal best lands. */
  fanfare(): void {
    if (!this.ctx || this.muted) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      setTimeout(() => this.blip(f, 0.22, 0.12, 'triangle'), i * 95);
    });
  }

  /** The live context, so recorded clips decode and play through the same
   *  graph - and therefore obey mute and volume like everything else. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Bus recorded voice lines should join. */
  get bus(): AudioNode | null {
    return this.master ?? null;
  }

  /** For the diagnostics readout - "running" is the only healthy value. */
  get status(): string {
    if (!this.started) return 'not started';
    return `${this.ctx?.state ?? 'none'}${this.muted ? ' (muted)' : ''}`;
  }

  resumeIfNeeded(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }
}
