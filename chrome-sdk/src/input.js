// Helpers for forwarding chrome input to Wayland clients.

// Map a JS KeyboardEvent.code to a Linux evdev keycode (from
// input-event-codes.h). The compositor adds the +8 xkb offset.
const EVDEV_BY_CODE = {
  Escape: 1,
  Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6,
  Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  Minus: 12, Equal: 13, Backspace: 14, Tab: 15,
  KeyQ: 16, KeyW: 17, KeyE: 18, KeyR: 19, KeyT: 20, KeyY: 21,
  KeyU: 22, KeyI: 23, KeyO: 24, KeyP: 25, BracketLeft: 26, BracketRight: 27,
  Enter: 28, ControlLeft: 29,
  KeyA: 30, KeyS: 31, KeyD: 32, KeyF: 33, KeyG: 34, KeyH: 35,
  KeyJ: 36, KeyK: 37, KeyL: 38, Semicolon: 39, Quote: 40, Backquote: 41,
  ShiftLeft: 42, Backslash: 43,
  KeyZ: 44, KeyX: 45, KeyC: 46, KeyV: 47, KeyB: 48, KeyN: 49, KeyM: 50,
  Comma: 51, Period: 52, Slash: 53, ShiftRight: 54,
  NumpadMultiply: 55, AltLeft: 56, Space: 57, CapsLock: 58,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66,
  F9: 67, F10: 68, NumLock: 69, ScrollLock: 70, F11: 87, F12: 88,
  ControlRight: 97, AltRight: 100,
  Home: 102, ArrowUp: 103, PageUp: 104, ArrowLeft: 105, ArrowRight: 106,
  End: 107, ArrowDown: 108, PageDown: 109, Insert: 110, Delete: 111,
  MetaLeft: 125, MetaRight: 126, ContextMenu: 127,
};

/** Linux evdev keycode for a KeyboardEvent.code, or null if unmapped. */
export function evdevFromCode(code) {
  return Object.prototype.hasOwnProperty.call(EVDEV_BY_CODE, code) ? EVDEV_BY_CODE[code] : null;
}

/** Linux button code for a JS MouseEvent.button, or null. */
export function buttonCodeFromJs(button) {
  switch (button) {
    case 0:
      return 0x110; // BTN_LEFT
    case 1:
      return 0x112; // BTN_MIDDLE
    case 2:
      return 0x111; // BTN_RIGHT
    default:
      return null;
  }
}

/**
 * Map a client pointer position to surface-local coordinates, scaling the
 * element's on-screen box to the surface's pixel size. Returns null if the
 * element has no layout box yet.
 */
export function surfaceLocal(rect, clientX, clientY, surfaceW, surfaceH) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const sw = surfaceW || rect.width;
  const sh = surfaceH || rect.height;
  return {
    x: ((clientX - rect.left) / rect.width) * sw,
    y: ((clientY - rect.top) / rect.height) * sh,
  };
}
