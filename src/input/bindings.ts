/**
 * The control scheme targets an Xbox controller; the keyboard map is a fallback
 * for desktop testing. The on-screen card renders straight from here, so it
 * cannot drift from the actual mapping.
 */

/** Standard Gamepad API indices, which an Xbox controller reports directly. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16,
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

/** The on-screen card renders from this, so it cannot drift from the mapping. */
export const BINDINGS: BindingRow[] = [
  { action: 'Throttle', pad: 'RT', key: 'W  /  ↑' },
  { action: 'Brake · reverse when stopped', pad: 'LT', key: 'S  /  ↓' },
  { action: 'Steer', pad: 'Left stick ←→', key: 'A  D  /  ←  →' },
  { action: 'Pull back (lift the front)', pad: 'Left stick ↓', key: 'Space' },
  { action: 'Lean forward (bring it down)', pad: 'Left stick ↑', key: 'Shift' },
  { action: 'Shift up', pad: 'RB', key: 'E' },
  { action: 'Shift down', pad: 'LB', key: 'Q' },
  { action: 'Knee on the seat (while up)', pad: 'A', key: '1' },
  { action: 'Stand on the seat (while up)', pad: 'X', key: '2' },
  { action: 'Change camera', pad: 'Y', key: 'C' },
  { action: 'Look around', pad: 'Right stick', key: 'Drag mouse' },
  { action: 'Reset', pad: 'Menu / B', key: 'R' },
  { action: 'Menu / exit to menu', pad: 'View', key: 'H' },
  { action: 'GPS: fixed / arrow / off', pad: 'D-pad down', key: 'G' },
  { action: 'Diagnostics', pad: 'D-pad up', key: 'D' },
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
  trickKnee: ['Digit1'],
  trickStand: ['Digit2'],
  camera: ['KeyC'],
  reset: ['KeyR'],
  toggleHelp: ['KeyH'],
  toggleDebug: ['KeyP'],
  toggleAudio: ['KeyM'],
  cycleMap: ['KeyG'],
  diagnostics: ['KeyD'],
} as const;

export type KeyAction = keyof typeof KEY_MAP;
