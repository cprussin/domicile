// Helpers for forwarding chrome input to Wayland clients.

// Map a JS KeyboardEvent.code to a Linux evdev keycode (from
// input-event-codes.h). The compositor adds the +8 xkb offset.
const EVDEV_BY_CODE: Readonly<Record<string, number>> = {
  AltLeft: 56,
  AltRight: 100,
  ArrowDown: 108,
  ArrowLeft: 105,
  ArrowRight: 106,
  ArrowUp: 103,
  Backquote: 41,
  Backslash: 43,
  Backspace: 14,
  BracketLeft: 26,
  BracketRight: 27,
  CapsLock: 58,
  Comma: 51,
  ContextMenu: 127,
  ControlLeft: 29,
  ControlRight: 97,
  Delete: 111,
  Digit0: 11,
  Digit1: 2,
  Digit2: 3,
  Digit3: 4,
  Digit4: 5,
  Digit5: 6,
  Digit6: 7,
  Digit7: 8,
  Digit8: 9,
  Digit9: 10,
  End: 107,
  Enter: 28,
  Equal: 13,
  Escape: 1,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  F11: 87,
  F12: 88,
  Home: 102,
  Insert: 110,
  KeyA: 30,
  KeyB: 48,
  KeyC: 46,
  KeyD: 32,
  KeyE: 18,
  KeyF: 33,
  KeyG: 34,
  KeyH: 35,
  KeyI: 23,
  KeyJ: 36,
  KeyK: 37,
  KeyL: 38,
  KeyM: 50,
  KeyN: 49,
  KeyO: 24,
  KeyP: 25,
  KeyQ: 16,
  KeyR: 19,
  KeyS: 31,
  KeyT: 20,
  KeyU: 22,
  KeyV: 47,
  KeyW: 17,
  KeyX: 45,
  KeyY: 21,
  KeyZ: 44,
  MetaLeft: 125,
  MetaRight: 126,
  Minus: 12,
  NumLock: 69,
  NumpadMultiply: 55,
  PageDown: 109,
  PageUp: 104,
  Period: 52,
  Quote: 40,
  ScrollLock: 70,
  Semicolon: 39,
  ShiftLeft: 42,
  ShiftRight: 54,
  Slash: 53,
  Space: 57,
  Tab: 15,
};

/** Linux evdev keycode for a KeyboardEvent.code, or `undefined` if unmapped. */
export const evdevFromCode = (code: string): number | undefined =>
  EVDEV_BY_CODE[code];

// Linux input-event-codes.h button codes. Written as the header writes them:
// the digit grouping biome would otherwise impose reads as a different number.
// biome-ignore-start lint/style/useNumericSeparators: mirrors input-event-codes.h
export const BTN_LEFT = 0x110;
export const BTN_RIGHT = 0x111;
export const BTN_MIDDLE = 0x112;
// biome-ignore-end lint/style/useNumericSeparators: mirrors input-event-codes.h

// MouseEvent.button numbering: 0 primary, 1 auxiliary, 2 secondary.
const BUTTON_CODE_BY_JS: Readonly<Record<number, number>> = {
  0: BTN_LEFT,
  1: BTN_MIDDLE,
  2: BTN_RIGHT,
};

/** Linux button code for a JS MouseEvent.button, or `undefined` if unmapped. */
export const buttonCodeFromJs = (button: number): number | undefined =>
  BUTTON_CODE_BY_JS[button];

/** An element's on-screen box, as much of `DOMRect` as the mapping needs. */
export type ElementBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SurfacePoint = { x: number; y: number };

/**
 * Map a client pointer position to surface-local coordinates, scaling the
 * element's on-screen box to the surface's pixel size.
 *
 * @param surfaceWidth - The client surface's pixel width; `0` (no frame drawn
 *   yet) falls back to the element's own box, which is a 1:1 mapping.
 * @returns `undefined` when the element has no layout box yet, so there is no
 *   meaningful coordinate to report.
 */
export const surfaceLocal = (
  box: ElementBox,
  clientX: number,
  clientY: number,
  surfaceWidth: number,
  surfaceHeight: number,
): SurfacePoint | undefined => {
  if (box.width <= 0 || box.height <= 0) {
    return undefined;
  }
  const scaleX = surfaceWidth > 0 ? surfaceWidth : box.width;
  const scaleY = surfaceHeight > 0 ? surfaceHeight : box.height;
  return {
    x: ((clientX - box.left) / box.width) * scaleX,
    y: ((clientY - box.top) / box.height) * scaleY,
  };
};
