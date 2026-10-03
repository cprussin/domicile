// What a press does in a shell's keys.
//
// Pure, and apart from `bind-keys.ts`, because this is the decision in
// answering a key — which press is which chord — and a decision inside a DOM
// listener cannot be asserted on.

import type { KeybindingsByMode, ShortcutMessage } from "./host-message";
import type { KeyAction } from "./key-action";

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
