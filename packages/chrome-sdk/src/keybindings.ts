// One shell's keys, out of the config's, and what a press does in them.
//
// Pure, and apart from `bind-keys.ts`, because these are the two decisions in
// answering a key — whose binding wins, and which press is which chord — and a
// decision inside a DOM listener cannot be asserted on.

import type {
  Keybinding,
  KeybindingsByMode,
  ShellConfigMessage,
  ShortcutMessage,
} from "./host-message";
import type { KeyAction } from "./key-action";

/**
 * The bindings `shell` answers, by mode: the desk's, with the shell's own
 * section on top of them.
 *
 * Mode by mode, and the shell's binding wins a chord both tables bind — the
 * same chord meaning two things in one mode is not a desktop anybody can use,
 * and the shell's table is the more particular of the two. A mode only one
 * table declares is a mode all the same.
 */
export const keybindingsFor = (
  config: ShellConfigMessage,
  shell: string,
): KeybindingsByMode =>
  layered(
    config.shells.get(shell)?.keybindings ?? new Map(),
    config.keybindings,
  );

/**
 * `over` on top of `under`, mode by mode: every binding of `over`, and those
 * of `under` on a chord `over` leaves alone. A mode only one of them declares
 * is a mode all the same.
 */
export const layered = (
  over: KeybindingsByMode,
  under: KeybindingsByMode,
): KeybindingsByMode => {
  const modes = new Set([...under.keys(), ...over.keys()]);
  return new Map(
    [...modes].map((mode) => {
      const top: readonly Keybinding[] = over.get(mode) ?? [];
      const rest = (under.get(mode) ?? []).filter(
        ({ shortcut }) =>
          !top.some((binding) => sameChord(binding.shortcut, shortcut)),
      );
      return [mode, [...top, ...rest]];
    }),
  );
};

/**
 * What `press` does in `mode`, or `undefined` when nothing there is bound to
 * it.
 *
 * Every modifier is part of the chord, the way the compositor's claim is:
 * Ctrl+Meta+Return is a combination nobody bound.
 */
export const actionFor = (
  bindings: KeybindingsByMode,
  mode: string,
  press: ShortcutMessage,
): KeyAction | undefined =>
  bindings.get(mode)?.find(({ shortcut }) => sameChord(shortcut, press))
    ?.action;

/** Whether two chords are one: the same key, with the same modifiers held. */
export const sameChord = (a: ShortcutMessage, b: ShortcutMessage): boolean =>
  a.keycode === b.keycode &&
  a.altKey === b.altKey &&
  a.ctrlKey === b.ctrlKey &&
  a.shiftKey === b.shiftKey &&
  a.metaKey === b.metaKey;
