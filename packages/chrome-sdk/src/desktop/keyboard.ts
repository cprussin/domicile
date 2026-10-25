// The keyboard: chords the shell grabs from clients, and the seat's held
// modifiers. See docs/architecture/KEYBINDINGS.md.

import type { DomicileHost, DomicileShortcutEvent } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/** A grabbed chord, pressed or let go. `keycode` is an evdev code. */
export type Shortcut = {
  chord: string;
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/**
 * The seat's modifiers, which count only keys forwarded to a client. See
 * "Reading held modifiers" in packages/chrome-sdk/docs/ELEMENTS.md.
 */
export type Modifiers = {
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
};

export type KeyboardListeners = {
  /** A grabbed chord was pressed, in a `<webview>` or on the page. */
  shortcut: (shortcut: Shortcut) => void;
  /** A pressed chord's key or one of its modifiers came up. */
  shortcutrelease: (shortcut: Shortcut) => void;
  modifierschange: () => void;
};

export type Keyboard = {
  /** `undefined` until the compositor says. */
  readonly modifiers: Modifiers | undefined;
  /**
   * Route `chord`, in sway's grammar such as `Meta+Shift+l`, to the page
   * rather than to the focused client. Throws a SyntaxError for a chord
   * written wrong.
   */
  grab: (chord: string) => void;
  /** Answer one {@link Keyboard.grab}; the last gives the key back. */
  ungrab: (chord: string) => void;
  on: On<KeyboardListeners>;
};

export type KeyboardHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "altKey"
  | "ctrlKey"
  | "grabShortcut"
  | "metaKey"
  | "removeEventListener"
  | "shiftKey"
  | "ungrabShortcut"
>;

export const keyboard = (host: KeyboardHost): Keyboard => ({
  grab: (chord) => {
    host.grabShortcut(chord);
  },
  get modifiers() {
    return modifiersOf(host);
  },
  on: on<KeyboardListeners>({
    modifierschange: (listener) =>
      hostEvent(host, "modifierschanged", () => listener()),
    shortcut: (listener) =>
      hostEvent(host, "shortcut", (event) => listener(shortcutOf(event))),
    shortcutrelease: (listener) =>
      hostEvent(host, "shortcutrelease", (event) =>
        listener(shortcutOf(event)),
      ),
  }),
  ungrab: (chord) => {
    host.ungrabShortcut(chord);
  },
});

const modifiersOf = ({
  altKey,
  ctrlKey,
  shiftKey,
  metaKey,
}: KeyboardHost): Modifiers | undefined =>
  altKey === null || ctrlKey === null || shiftKey === null || metaKey === null
    ? undefined
    : { alt: altKey, ctrl: ctrlKey, meta: metaKey, shift: shiftKey };

const shortcutOf = (event: DomicileShortcutEvent): Shortcut => ({
  altKey: event.altKey,
  chord: event.chord,
  ctrlKey: event.ctrlKey,
  keycode: event.keycode,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
});
