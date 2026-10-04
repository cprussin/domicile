// The page's copy of the shortcuts the shell claimed.
//
// `grabShortcut` registers claims in the browser process, which covers focused
// `<webview>`s. Keys for a focused Wayland window pass through this page
// instead, so `keyboard-input.ts` checks this set to avoid forwarding them.
//
// Mirrors the engine's `ShortcutRegistry`: claims belong to the page and are
// never released, so a shell re-claiming in an effect leaves no gap.

import type { DomicileShortcut } from "./domicile-host";

/** A key that went down, in the terms a claim is written in. */
export type KeyPress = {
  /** An evdev key code. */
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

// Keyed by `chord`, so repeated claims are deduplicated.
const claimed = new Set<string>();

/** Claim a key combination so it is not forwarded to windows. */
export const claimShortcut = ({
  altKey = false,
  ctrlKey = false,
  keycode,
  metaKey = false,
  shiftKey = false,
}: DomicileShortcut): void => {
  claimed.add(chord({ altKey, ctrlKey, keycode, metaKey, shiftKey }));
};

/** Whether a press matches a claimed combination. */
export const isClaimed = (press: KeyPress): boolean =>
  claimed.has(chord(press));

/**
 * The set key for a combination.
 *
 * Includes every modifier, so an omitted modifier must not be held.
 */
const chord = ({
  altKey,
  ctrlKey,
  keycode,
  metaKey,
  shiftKey,
}: KeyPress): string => [keycode, altKey, ctrlKey, shiftKey, metaKey].join(":");
