// Parses a shell's own keybindings and gives each chord one spelling.
//
// The shell writes chords sway-style (`Meta+Shift+l`); the engine finds each
// keysym's key (`grabShortcut`). One spelling makes `Shift+Meta+l` and
// `Meta+Shift+l` one grab, and lets a `shortcut` event's `chord` find its
// binding. See `docs/architecture/KEYBINDINGS.md`.

import type { KeyAction } from "./key-action";

/** One mode's bindings, from chord (`Meta+Shift+l`) to action. */
export type ModeKeybindings = Readonly<Record<string, KeyAction>>;

/** A shell's keybindings: the `default` mode plus other modes by name. */
export type ShellKeybindings = {
  /** The `default` mode, active until a binding changes mode. */
  readonly keybindings?: ModeKeybindings;
  /** Other modes, by name. */
  readonly modes?: Readonly<Record<string, ModeKeybindings>>;
};

/** Each mode's bindings, by chord in its one spelling. */
export type KeybindingsByMode = ReadonlyMap<
  string,
  ReadonlyMap<string, KeyAction>
>;

/** Modifier order in a spelled chord. */
const ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;

type Modifier = (typeof ORDER)[number];

/**
 * Modifier names sway accepts, lowercased. A `Map` so `constructor` is not a
 * modifier.
 */
const MODIFIERS: ReadonlyMap<string, Modifier> = new Map([
  ["alt", "Alt"],
  ["control", "Ctrl"],
  ["ctrl", "Ctrl"],
  ["logo", "Meta"],
  ["meta", "Meta"],
  ["mod1", "Alt"],
  ["mod4", "Meta"],
  ["shift", "Shift"],
  ["super", "Meta"],
]);

/**
 * Files `own` by mode and spelled chord.
 *
 * Throws on a malformed chord, two spellings of one chord in a mode, or a
 * `modes.default`, so a bad binding fails loudly.
 */
export const ownKeybindings = (own: ShellKeybindings): KeybindingsByMode => {
  const modes = own.modes ?? {};
  if (Object.hasOwn(modes, "default")) {
    throw new Error(
      "domicile: `modes.default` is not a mode of its own; mode `default` is `keybindings`",
    );
  }
  return new Map(
    [["default", own.keybindings ?? {}] as const, ...Object.entries(modes)].map(
      ([mode, bindings]) => [mode, filed(bindings)],
    ),
  );
};

/**
 * Every chord `own` binds in any mode, once each, in its one spelling. Throws
 * as {@link ownKeybindings} does.
 */
export const ownedChords = (own: ShellKeybindings): readonly string[] => [
  ...new Set(
    [...ownKeybindings(own).values()].flatMap((byChord) => [...byChord.keys()]),
  ),
];

/** One mode's bindings by chord. Throws on two spellings of one chord. */
const filed = (bindings: ModeKeybindings): ReadonlyMap<string, KeyAction> =>
  Object.entries(bindings).reduce((by, [written, action]) => {
    const chord = spelled(written);
    if (by.has(chord)) {
      throw new Error(
        `domicile: chord ${JSON.stringify(written)} is ${chord}, which this mode already binds`,
      );
    }
    return by.set(chord, action);
  }, new Map<string, KeyAction>());

/** `written` in its one spelling: modifiers in {@link ORDER}, then the keysym. */
export const spelled = (written: string): string => {
  if (/\s/.test(written)) {
    throw new Error(
      `domicile: chord ${JSON.stringify(written)} has whitespace in it; write it as \`Meta+Shift+a\``,
    );
  }
  const parts = written.split("+");
  const keysym = parts.at(-1) ?? "";
  if (keysym === "" || MODIFIERS.has(keysym.toLowerCase())) {
    throw new Error(
      `domicile: chord ${JSON.stringify(written)} names no key; its last part is the keysym`,
    );
  }
  const held = parts.slice(0, -1).reduce((modifiers, part) => {
    const modifier = MODIFIERS.get(part.toLowerCase());
    if (modifier === undefined) {
      throw new Error(
        `domicile: chord ${JSON.stringify(written)}: ${JSON.stringify(part)} is not a modifier`,
      );
    } else if (modifiers.has(modifier)) {
      throw new Error(
        `domicile: chord ${JSON.stringify(written)} holds ${JSON.stringify(part)} twice, under one spelling or two`,
      );
    } else {
      return modifiers.add(modifier);
    }
  }, new Set<Modifier>());
  return [...ORDER.filter((modifier) => held.has(modifier)), keysym].join("+");
};
