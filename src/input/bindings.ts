/**
 * The control scheme is designed for a DualSense first; the keyboard map is a
 * fallback for desktop testing. Keep these two tables in sync with the on-screen
 * overlay in ui/ControlsOverlay.ts - it renders straight from here.
 */

/**
 * Standard Gamepad API indices. A DualSense and an Xbox pad both report this
 * layout, so the same constants drive both: R2/RT is 7, L2/LT is 6, R1/RB is
 * 5, L1/LB is 4, Options/Menu is 9, Circle/B is 1.
 */
export const PAD = {
  CROSS: 0,
  CIRCLE: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  CREATE: 8,
  OPTIONS: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  PS: 16,
  TOUCHPAD: 17,
} as const;

export const AXIS = {
  LEFT_X: 0,
  LEFT_Y: 1,
  RIGHT_X: 2,
  RIGHT_Y: 3,
} as const;

export interface BindingRow {
  action: string;
  pad: string;
  key: string;
}

/**
 * Which family of controller is in the player's hands.
 *
 * The button *indices* are identical across all of them - the Standard Gamepad
 * mapping puts the triggers at 6/7 and the shoulders at 4/5 whether it is a
 * DualSense or an Xbox pad - so only the printed labels differ.
 */
export type PadFamily = 'playstation' | 'xbox' | 'generic';

const PAD_LABELS: Record<PadFamily, Record<string, string>> = {
  playstation: {
    throttle: 'R2', brake: 'L2', up: 'R1', down: 'L1',
    reset: 'Options / ○', help: 'Create',
  },
  xbox: {
    throttle: 'RT', brake: 'LT', up: 'RB', down: 'LB',
    reset: 'Menu / B', help: 'View',
  },
  generic: {
    throttle: 'Right trigger', brake: 'Left trigger',
    up: 'Right bumper', down: 'Left bumper',
    reset: 'Start', help: 'Select',
  },
};

export function bindingsFor(family: PadFamily): BindingRow[] {
  const L = PAD_LABELS[family];
  return [
    { action: 'Throttle', pad: L.throttle, key: 'W  /  ↑' },
    { action: 'Brake', pad: L.brake, key: 'S  /  ↓' },
    { action: 'Steer', pad: 'Left stick ←→', key: 'A  D  /  ←  →' },
    { action: 'Pull back (lift the front)', pad: 'Left stick ↓', key: 'Space' },
    { action: 'Lean forward (bring it down)', pad: 'Left stick ↑', key: 'Shift' },
    { action: 'Shift up', pad: L.up, key: 'E' },
    { action: 'Shift down', pad: L.down, key: 'Q' },
    { action: 'Camera', pad: 'Right stick', key: 'Drag mouse' },
    { action: 'Reset', pad: L.reset, key: 'R' },
    { action: 'Controls overlay', pad: L.help, key: 'H' },
    { action: 'Debug panel', pad: '—', key: 'P' },
  ];
}

export const KEY_MAP = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  pullBack: ['Space'],
  leanForward: ['ShiftLeft', 'ShiftRight'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  reset: ['KeyR'],
  toggleHelp: ['KeyH'],
  toggleDebug: ['KeyP'],
  toggleAudio: ['KeyM'],
} as const;

export type KeyAction = keyof typeof KEY_MAP;
