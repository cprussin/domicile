// Which physical key a keysym is on, under Programmer's Dvorak.
//
// **Why a shell has to care.** sway's config binds *keysyms* — `bindsym
// $mod+h`, `bindsym $mod+parenleft` — and resolves them through the active
// keymap, so which key you press for one depends on the layout. Nothing here
// can do that: a chord claimed from the compositor is an evdev keycode, and a
// press this page hears is a `KeyboardEvent.code`, both of which name the
// physical key and neither of which knows the layout. The engine does not tell
// a shell what the keymap is.
//
// So the layout is written down instead, once, here — and it is the layout
// this desktop comes up on: `dvp` with Caps Lock and Escape swapped is what
// manganese configures when the config names no keyboard, and it is what the
// bindings were written against. `bindings.ts` names the keysyms the sway
// config names, and this is what turns each one into the key the user actually
// presses.
//
// A desktop configured for a different layout keeps these *keys*: it answers
// `mod` and the physical J wherever the letter `h` has moved to. That is the
// trade — one wrong layout and the chords are in the wrong place, and there is
// nothing in the channel to read the right one from.

/**
 * The key each keysym is on, row by row, as the keyboard reads.
 *
 * The number row is the one worth checking against the config: the workspace
 * chords are `parenleft` through `asterisk`, which all live on it.
 */
const CODE_BY_KEYSYM: Readonly<Record<string, string>> = {
  // a o e u i d h t n s -
  a: "KeyA",
  ampersand: "Digit1",

  // ' q j k x b m w v z
  apostrophe: "KeyZ",
  asterisk: "Digit7",
  at: "BracketRight",
  b: "KeyN",
  braceleft: "Digit3",
  braceright: "Digit4",
  bracketleft: "Digit2",
  bracketright: "Digit0",
  c: "KeyI",
  comma: "KeyW",

  // And the keys every layout agrees on.
  Down: "ArrowDown",
  d: "KeyH",
  // $ & [ { } ( = * ) + ] ! #
  dollar: "Backquote",
  Escape: "Escape",
  e: "KeyD",
  equal: "Digit6",
  exclam: "Minus",
  f: "KeyY",
  g: "KeyU",
  h: "KeyJ",
  i: "KeyG",
  j: "KeyC",
  k: "KeyV",
  Left: "ArrowLeft",
  l: "KeyP",
  m: "KeyM",
  minus: "Quote",
  n: "KeyL",
  numbersign: "Equal",
  o: "KeyS",
  p: "KeyR",
  parenleft: "Digit5",
  parenright: "Digit8",
  period: "KeyE",
  plus: "Digit9",
  q: "KeyX",
  Return: "Enter",
  Right: "ArrowRight",
  r: "KeyO",
  s: "Semicolon",

  // ; , . p y f g c r l / @
  semicolon: "KeyQ",
  slash: "BracketLeft",
  space: "Space",
  Tab: "Tab",
  t: "KeyK",
  Up: "ArrowUp",
  u: "KeyF",
  v: "Period",
  w: "Comma",
  x: "KeyB",
  y: "KeyT",
  z: "Slash",
};

/**
 * The `KeyboardEvent.code` of the key that produces `keysym`.
 *
 * Throws for a keysym the layout above does not cover: the bindings are the
 * shell's own table, so a name it cannot place is a typo in that table rather
 * than anything a user can do.
 */
export const codeFor = (keysym: string): string => {
  const code = CODE_BY_KEYSYM[keysym];
  if (code === undefined) {
    throw new Error(`keyboard: no key for the keysym ${keysym}`);
  } else {
    return code;
  }
};
