// The chords the desktop claimed, kept where the page can be asked about them.
//
// WHY THE PAGE KEEPS A COPY. `grabShortcut` claims a combination in the
// browser process, and that is the only layer above a focused `<webview>` — a
// guest's keys reach neither this document nor the compositor, so the claim
// has to be matched there. It is not the only layer above a focused *Wayland*
// window: that window is an `<app>` element in this very page, DOM focus never
// leaves the document, and every keystroke arrives here for `keyboard-input.ts`
// to forward. A claim the forwarding does not know about is a chord the desktop
// answers *and* the window receives — Alt+Enter spawning a terminal and typing
// a newline into the one that was already open.
//
// So this mirrors `ShortcutRegistry` in the engine, and deliberately mirrors
// its shape as well: the claims are the page's rather than any one client's,
// and a claim is never given back. A shell re-running the effect that made one
// is making the same claim, and a gap between the two is a chord the focused
// window gets instead.

import type { DomicileShortcut } from "./domicile-host";

/** A key that went down, in the terms a claim is written in. */
export type KeyPress = {
  /** An evdev code, the numbering the control channel speaks throughout. */
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

// Each claim as one string, so that claiming a combination twice is one claim
// and asking about a press is a lookup rather than a walk. A shell's effect
// re-runs on every dependency change and claims again each time.
const claimed = new Set<string>();

/** Take a combination for the desktop, so no window is sent it. */
export const claimShortcut = ({
  altKey = false,
  ctrlKey = false,
  keycode,
  metaKey = false,
  shiftKey = false,
}: DomicileShortcut): void => {
  claimed.add(chord({ altKey, ctrlKey, keycode, metaKey, shiftKey }));
};

/** Whether this press is one of them. */
export const isClaimed = (press: KeyPress): boolean =>
  claimed.has(chord(press));

/**
 * One claim written as one value.
 *
 * Every modifier is part of it, which is what makes an omitted one a modifier
 * that must *not* be held: Ctrl+Alt+Enter is a different string from Alt+Enter
 * and nobody claimed it.
 */
const chord = ({
  altKey,
  ctrlKey,
  keycode,
  metaKey,
  shiftKey,
}: KeyPress): string => [keycode, altKey, ctrlKey, shiftKey, metaKey].join(":");
