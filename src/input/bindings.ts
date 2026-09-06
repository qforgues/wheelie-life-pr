/**
 * The control scheme is designed for a DualSense first; the keyboard map is a
 * fallback for desktop testing. Keep these two tables in sync with the on-screen
 * overlay in ui/ControlsOverlay.ts - it renders straight from here.
 */

/** Standard Gamepad API indices, which a DualSense reports correctly in Chrome. */
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

export const BINDINGS: BindingRow[] = [
  { action: 'Throttle', pad: 'R2', key: 'W  /  ↑' },
  { action: 'Brake', pad: 'L2', key: 'S  /  ↓' },
  { action: 'Steer', pad: 'Left stick ←→', key: 'A  D  /  ←  →' },
  { action: 'Pull back (lift the front)', pad: 'Left stick ↓', key: 'Space' },
  { action: 'Lean forward (bring it down)', pad: 'Left stick ↑', key: 'Shift' },
  { action: 'Shift up', pad: 'R1', key: 'E' },
  { action: 'Shift down', pad: 'L1', key: 'Q' },
  { action: 'Camera', pad: 'Right stick', key: 'Drag mouse' },
  { action: 'Reset', pad: 'Options / ○', key: 'R' },
  { action: 'Controls overlay', pad: 'Create', key: 'H' },
  { action: 'Debug panel', pad: '—', key: 'P' },
];

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
