// Resolves a shell's own keybindings to keycodes.
//
// The shell writes chords sway-style (`Meta+Shift+l`). The compositor sends
// the keysym-to-keycode map in `shell_config`'s `keys`. See
// `docs/architecture/KEYBINDINGS.md`.

import type {
  Keybinding,
  KeybindingsByMode,
  ShortcutMessage,
} from "./host-message";
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

/**
 * Modifier names sway accepts. A `Map` so `constructor` is not a modifier.
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
 * Resolves every chord in `own` to a keycode using `keys`.
 *
 * Throws on a malformed chord or a keysym the keyboard lacks, so a bad
 * binding fails loudly instead of silently doing nothing.
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

/** Parses chord `written` into a keycode and modifiers. */
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
