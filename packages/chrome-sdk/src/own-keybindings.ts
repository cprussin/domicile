// The keys a shell binds itself, resolved against the keyboard the compositor
// describes.
//
// A shell's keybindings are its props, so the page holds the chords — written
// sway-style, `Meta+Shift+l` — and only the compositor holds the keymap. The
// compositor sends every keysym the keyboard can type and the key it is on
// (`shell_config`'s `keys`), and this is the rest: the chord grammar, and the
// lookup.

import type {
  Keybinding,
  KeybindingsByMode,
  ShortcutMessage,
} from "./host-message";
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

/**
 * The modifiers a chord can hold, by every spelling sway's accept. A map
 * rather than a record, so `constructor` is not a modifier.
 */
const MODIFIERS: ReadonlyMap<string, keyof Omit<ShortcutMessage, "keycode">> =
  new Map([
    ["alt", "altKey"],
    ["control", "ctrlKey"],
    ["ctrl", "ctrlKey"],
    ["logo", "metaKey"],
    ["meta", "metaKey"],
    ["mod1", "altKey"],
    ["mod4", "metaKey"],
    ["shift", "shiftKey"],
    ["super", "metaKey"],
  ]);

/**
 * `own`, every chord resolved to the key `keys` has its keysym on.
 *
 * Throws on a chord that is not one and on a keysym the keyboard
 * cannot type, naming it: both are the shell's bindings being wrong, and a
 * desktop that quietly dropped a key would leave its user pressing one that
 * does nothing.
 */
export const ownKeybindings = (
  own: ShellKeybindings,
  keys: ReadonlyMap<string, number>,
): KeybindingsByMode => {
  const modes = own.modes ?? {};
  if (Object.hasOwn(modes, "default")) {
    throw new Error(
      "domicile: `modes.default` is not a mode of its own; mode `default` is `keybindings`",
    );
  }
  return new Map(
    [["default", own.keybindings ?? {}] as const, ...Object.entries(modes)].map(
      ([mode, bindings]) => [
        mode,
        Object.entries(bindings).map(
          ([chord, action]): Keybinding => ({
            action,
            shortcut: shortcutOf(chord, keys),
          }),
        ),
      ],
    ),
  );
};

/** `written`, as the key and the modifiers a press of it arrives as. */
const shortcutOf = (
  written: string,
  keys: ReadonlyMap<string, number>,
): ShortcutMessage => {
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
  const keycode = keys.get(keysym);
  if (keycode === undefined) {
    throw new Error(
      `domicile: chord ${JSON.stringify(written)}: ${JSON.stringify(keysym)} is on no key of this keyboard`,
    );
  }
  const held: ShortcutMessage = {
    altKey: false,
    ctrlKey: false,
    keycode,
    metaKey: false,
    shiftKey: false,
  };
  return parts.slice(0, -1).reduce((chord, part) => {
    const modifier = MODIFIERS.get(part.toLowerCase());
    if (modifier === undefined) {
      throw new Error(
        `domicile: chord ${JSON.stringify(written)}: ${JSON.stringify(part)} is not a modifier`,
      );
    } else if (chord[modifier]) {
      throw new Error(
        `domicile: chord ${JSON.stringify(written)} holds ${JSON.stringify(part)} twice, under one spelling or two`,
      );
    } else {
      return { ...chord, [modifier]: true };
    }
  }, held);
};
