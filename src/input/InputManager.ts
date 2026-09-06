import { emptyInput, type RiderInput, type TrickId } from '../sim/types';
import { AXIS, KEY_MAP, PAD, type KeyAction } from './bindings';

export interface FrameInput {
  rider: RiderInput;
  /** Right stick / mouse drag, -1..1 per axis. */
  cameraX: number;
  cameraY: number;
  /** One-shot UI actions, true for a single frame. */
  reset: boolean;
  toggleHelp: boolean;
  toggleDebug: boolean;
  toggleAudio: boolean;
  /** One-shot: cycle to the next camera mode. */
  cycleCamera: boolean;
  /** One-shot: show or hide the diagnostics readout. */
  toggleDiagnostics: boolean;
  /** Which device produced input most recently - drives the overlay's hints. */
  activeDevice: 'gamepad' | 'keyboard';
  padConnected: boolean;
  padName: string;
}

const DEADZONE = 0.14;

function applyDeadzone(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
}

/**
 * Merges keyboard, mouse and gamepad into one engine-agnostic snapshot.
 *
 * Gamepad wins whenever it is being touched, so you can leave a controller
 * plugged in and still hit R on the keyboard without fighting the sticks.
 */
export class InputManager {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private prevPad: { buttons: boolean[]; } = { buttons: [] };
  private mouseDx = 0;
  private mouseDy = 0;
  private dragging = false;
  private lastDevice: 'gamepad' | 'keyboard' = 'keyboard';
  private padIndex: number | null = null;
  private padName = '';
  private rumbleUntil = 0;

  readonly frame: FrameInput = {
    rider: emptyInput(),
    cameraX: 0,
    cameraY: 0,
    reset: false,
    toggleHelp: false,
    toggleDebug: false,
    toggleAudio: false,
    cycleCamera: false,
    toggleDiagnostics: false,
    activeDevice: 'keyboard',
    padConnected: false,
    padName: '',
  };

  attach(target: HTMLElement): void {

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Don't hijack typing in the debug panel.
      if (isTextTarget(e.target)) return;
      if (isGameKey(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointerup', (e) => {
      this.dragging = false;
      target.releasePointerCapture?.(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });

    window.addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
      this.padName = e.gamepad.id;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.padIndex === e.gamepad.index) {
        this.padIndex = null;
        this.padName = '';
      }
    });
  }

  /** Raw gamepad, for the diagnostics panel. */
  rawPad(): Gamepad | null {
    return this.pad();
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) {
      if (p && p.connected) {
        this.padIndex = p.index;
        this.padName = p.id;
        return p;
      }
    }
    return null;
  }

  update(): FrameInput {
    const f = this.frame;
    const r = f.rider;
    const pad = this.pad();
    f.padConnected = !!pad;
    f.padName = pad ? shortPadName(this.padName || pad.id) : '';

    // ---- keyboard ----------------------------------------------------------
    let throttle = this.held('throttle') ? 1 : 0;
    let brake = this.held('brake') ? 1 : 0;
    let steer = (this.held('steerRight') ? 1 : 0) - (this.held('steerLeft') ? 1 : 0);
    let weight = (this.held('pullBack') ? 1 : 0) - (this.held('leanForward') ? 1 : 0);
    // Tricks are held, not toggled: let go and the rider sits back down.
    let trick: TrickId = this.held('trickStand') ? 'stand'
      : this.held('trickKnee') ? 'knee' : 'none';
    let cycleCamera = this.pressed('camera');
    let toggleDiagnostics = this.pressed('diagnostics');
    let shiftUp = this.pressed('shiftUp');
    let shiftDown = this.pressed('shiftDown');
    let reset = this.pressed('reset');
    const toggleHelp = this.pressed('toggleHelp');
    const toggleDebug = this.pressed('toggleDebug');
    const toggleAudio = this.pressed('toggleAudio');

    let camX = this.mouseDx * 0.03;
    let camY = this.mouseDy * 0.03;
    this.mouseDx = 0;
    this.mouseDy = 0;

    // ---- gamepad -----------------------------------------------------------
    if (pad) {
      const btn = (i: number) => pad.buttons[i]?.value ?? 0;
      const down = (i: number) => (pad.buttons[i]?.pressed ?? false);

      const padThrottle = btn(PAD.RT);
      const padBrake = btn(PAD.LT);
      const padSteer = applyDeadzone(pad.axes[AXIS.LEFT_X] ?? 0);
      // Stick Y is -1 when pushed up, so pulling back is a positive weight shift.
      const padWeight = applyDeadzone(pad.axes[AXIS.LEFT_Y] ?? 0);
      const padCamX = applyDeadzone(pad.axes[AXIS.RIGHT_X] ?? 0);
      const padCamY = applyDeadzone(pad.axes[AXIS.RIGHT_Y] ?? 0);

      const touched =
        padThrottle > 0.02 ||
        padBrake > 0.02 ||
        Math.abs(padSteer) > 0 ||
        Math.abs(padWeight) > 0 ||
        Math.abs(padCamX) > 0 ||
        Math.abs(padCamY) > 0 ||
        pad.buttons.some((b) => b.pressed);
      if (touched) this.lastDevice = 'gamepad';

      throttle = Math.max(throttle, padThrottle);
      brake = Math.max(brake, padBrake);
      if (Math.abs(padSteer) > Math.abs(steer)) steer = padSteer;
      if (Math.abs(padWeight) > Math.abs(weight)) weight = padWeight;
      camX += padCamX * 2.2;
      camY += padCamY * 2.2;

      shiftUp = shiftUp || this.padEdge(PAD.RB, down(PAD.RB));
      shiftDown = shiftDown || this.padEdge(PAD.LB, down(PAD.LB));
      reset = reset || this.padEdge(PAD.MENU, down(PAD.MENU))
        || this.padEdge(PAD.B, down(PAD.B));
      cycleCamera = cycleCamera || this.padEdge(PAD.Y, down(PAD.Y));
      toggleDiagnostics = toggleDiagnostics || this.padEdge(PAD.DPAD_UP, down(PAD.DPAD_UP));
      // Held, not edge-triggered - standing is a pose you hold.
      if (down(PAD.X)) trick = 'stand';
      else if (down(PAD.A)) trick = 'knee';
      // Keep the rest of the button edges warm so nothing double-fires.
      const edged: number[] = [PAD.RB, PAD.LB, PAD.MENU, PAD.B, PAD.Y, PAD.DPAD_UP];
      for (let i = 0; i < pad.buttons.length; i++) {
        if (!edged.includes(i)) this.prevPad.buttons[i] = down(i);
      }
    }

    r.throttle = clamp01(throttle);
    r.brake = clamp01(brake);
    r.steer = clampSigned(steer);
    r.weight = clampSigned(weight);
    r.shiftUp = shiftUp;
    r.shiftDown = shiftDown;
    r.trick = trick;

    f.cameraX = camX;
    f.cameraY = camY;
    f.reset = reset;
    f.toggleHelp = toggleHelp;
    f.toggleDebug = toggleDebug;
    f.toggleAudio = toggleAudio;
    f.cycleCamera = cycleCamera;
    f.toggleDiagnostics = toggleDiagnostics;
    f.activeDevice = this.lastDevice;

    this.pressedThisFrame.clear();
    return f;
  }

  private padEdge(index: number, isDown: boolean): boolean {
    const was = this.prevPad.buttons[index] ?? false;
    this.prevPad.buttons[index] = isDown;
    return isDown && !was;
  }

  private held(action: KeyAction): boolean {
    return KEY_MAP[action].some((k) => this.keys.has(k));
  }

  private pressed(action: KeyAction): boolean {
    return KEY_MAP[action].some((k) => this.pressedThisFrame.has(k));
  }

  /**
   * Switches the Xbox browser between driving its own cursor and handing raw
   * Gamepad API input to the page.
   *
   * This has to follow the menu, not be set once at startup. In `gamepad` mode
   * the console has no pointer at all, so a click-only menu becomes
   * unreachable - and because gamepad input is not a user-activation gesture in
   * Chromium, the audio context can never be unlocked either. So: `mouse` while
   * the start card is up, which lets the controller work the card and produces
   * a real gesture when RIDE is pressed; `gamepad` once riding.
   *
   * No-op on every other platform.
   */
  setGamepadEmulation(mode: 'mouse' | 'gamepad'): void {
    try {
      const nav = navigator as Navigator & { gamepadInputEmulation?: string };
      if ('gamepadInputEmulation' in nav) nav.gamepadInputEmulation = mode;
      this.emulation = mode;
    } catch {
      /* not supported here - nothing to do */
    }
  }

  /** Current emulation mode, for the diagnostics panel. */
  emulation: string = 'n/a';

  /**
   * Controller haptics. This is the *only* balance feedback channel besides
   * sound and the horizon - there is deliberately no balance meter on screen.
   */
  rumble(strong: number, weak: number, durationMs: number): void {
    const now = performance.now();
    if (now < this.rumbleUntil) return;
    const pad = this.pad();
    const actuator = (pad as unknown as { vibrationActuator?: GamepadHapticActuatorLike })
      ?.vibrationActuator;
    if (!actuator?.playEffect) return;
    this.rumbleUntil = now + durationMs * 0.6;
    actuator
      .playEffect('dual-rumble', {
        startDelay: 0,
        duration: durationMs,
        strongMagnitude: clamp01(strong),
        weakMagnitude: clamp01(weak),
      })
      .catch(() => {
        /* not supported on this pad/browser - fine, it's a bonus channel */
      });
  }
}

interface GamepadHapticActuatorLike {
  playEffect(type: string, params: Record<string, number>): Promise<unknown>;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clampSigned(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
function isGameKey(code: string): boolean {
  return (
    code === 'Space' ||
    code.startsWith('Arrow') ||
    ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyH', 'KeyP', 'KeyM'].includes(code)
  );
}
/** True when the page is running on an Xbox console browser. */
export function isXboxDevice(): boolean {
  return typeof navigator !== 'undefined' && /xbox/i.test(navigator.userAgent);
}

function shortPadName(id: string): string {
  if (/xbox|xinput|045e/i.test(id)) return 'Xbox controller';
  if (isXboxDevice()) return 'Xbox controller';
  return id.split('(')[0].trim().slice(0, 24) || 'Controller';
}
