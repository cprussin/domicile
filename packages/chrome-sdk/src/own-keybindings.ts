// The keys a shell binds itself, filed by chord.
//
// A shell's keybindings are its props, written sway-style — `Meta+Shift+l` —
// and the engine finds the key each keysym is on (`grabShortcut`). What is
// left here is the half that needs no keyboard: the grammar, and one spelling
// for each chord, so that `Shift+Meta+l` and `Meta+Shift+l` are one grab and
// a `shortcut` event's `chord` finds its binding in every mode.

import type { KeyAction } from "./key-action";

/** One mode's bindings: a chord, `Meta+Shift+l`, and what it does. */
export type ModeKeybindings = Readonly<Record<string, KeyAction>>;

/** The keys a shell binds: mode `default`, and its other modes by name. */
export type ShellKeybindings = {
  /** Mode `default`: what the keys do until a binding changes the mode. */
  readonly keybindings?: ModeKeybindings;
  /** Every other mode, by name. */
  readonly modes?: Readonly<Record<string, ModeKeybindings>>;
};

/** Every mode's bindings, by mode and then by chord in its one spelling. */
export type KeybindingsByMode = ReadonlyMap<
  string,
  ReadonlyMap<string, KeyAction>
>;

/** The modifiers in the order a chord is spelled with them. */
const ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;

type Modifier = (typeof ORDER)[number];

/**
 * The modifiers a chord can hold, by every spelling sway's accept, lowercased.
 * A map rather than a record, so `constructor` is not a modifier.
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
 * `own`, every chord in its one spelling.
 *
 * @throws for a chord written wrong — whitespace, no keysym, a part that is no
 *   modifier, one held twice — for two spellings of one chord in a mode, and
 *   for a `modes.default`, naming each.
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

/** One mode's bindings by chord, refusing two spellings of one. */
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
