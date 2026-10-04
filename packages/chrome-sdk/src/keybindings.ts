// Matches a key press to a shell keybinding.
//
// Kept separate from `bind-keys.ts` as pure functions so tests can assert on
// them.

import type { KeybindingsByMode, ShortcutMessage } from "./host-message";
import type { KeyAction } from "./key-action";

/**
 * The action bound to `press` in `mode`, or `undefined` if none.
 *
 * Modifiers must match exactly, as in the compositor's grab.
 */
export const actionFor = (
  bindings: KeybindingsByMode,
  mode: string,
  press: ShortcutMessage,
): KeyAction | undefined =>
  bindings.get(mode)?.find(({ shortcut }) => sameChord(shortcut, press))
    ?.action;

/** Whether two chords have the same key and modifiers. */
export const sameChord = (a: ShortcutMessage, b: ShortcutMessage): boolean =>
  a.keycode === b.keycode &&
  a.altKey === b.altKey &&
  a.ctrlKey === b.ctrlKey &&
  a.shiftKey === b.shiftKey &&
  a.metaKey === b.metaKey;
