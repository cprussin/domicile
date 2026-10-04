// A shell's keys, as it binds them, answered.
//
// A shell says what every key does — `"Meta+Return": KeyAction.SendShell(
// ["terminal"])` — and the engine does the rest of the keyboard's work:
// `grabShortcut(chord)` finds the key each keysym is on, and every press of
// one, in a `<webview>` or on the page, comes back as a `shortcut` event
// carrying the chord. What is left is the mode.
//
// **Modes are the SDK's.** `mode resize` changes what the same keys do, and
// the engine knows nothing about it, so the mode is tracked here and each
// press is read in it. A shell is told the mode moved, to draw it; it is never
// asked to move it.

import type { DomicileHost } from "./domicile-host";
import { KeyActionKind } from "./key-action";
import type { KeybindingsByMode, ShellKeybindings } from "./own-keybindings";
import { ownKeybindings } from "./own-keybindings";

/** The mode a desk starts in: a shell's `keybindings`. */
const DEFAULT_MODE = "default";

/** What a shell is told as its keys are answered. */
export type KeyHandlers = {
  /** A `send-shell` binding was pressed: the words after `send-shell`. */
  onCommand: (args: readonly string[]) => void;
  /** The keys are read in another binding mode now. */
  onModeChanged: (mode: string) => void;
};

/** What {@link bindKeys} hands back. */
export type KeyBinding = {
  /** Read the keys in `name` from now on — see {@link bindKeys}. */
  setMode: (name: string) => void;
  /** Stop answering. The grabs stay. */
  unbind: () => void;
};

/** What `bindKeys` uses of `window.domicile`. */
export type KeyHost = Pick<
  DomicileHost,
  "addEventListener" | "grabShortcut" | "removeEventListener"
>;

/**
 * Answer the keys a shell binds, `own`, on `domicile`.
 *
 * **Every chord of every mode is grabbed now**, each once, because a grab is
 * never given back — so a bare key bound in a mode is taken from every client
 * for the whole session, not only while the mode is on.
 *
 * **The mode is tracked here, and a shell can set it.** A desktop of several
 * pages shares one mode across them — a key that entered it may have landed on
 * another page — so `setMode` is how a page is told: the keys are read in that
 * mode from then on, and `onModeChanged` is not called for it, the shell
 * having said so itself. The mode the keys are already in does nothing; one
 * the shell does not have goes back to `default`, and that is reported.
 *
 * @throws for a chord written wrong — see `ownKeybindings` — before anything
 *   is grabbed. A keysym the keyboard cannot type is the engine's to say, and
 *   is logged rather than thrown, so the rest of the keys still work.
 */
export const bindKeys = (
  domicile: KeyHost,
  own: ShellKeybindings,
  { onCommand, onModeChanged }: KeyHandlers,
): KeyBinding => {
  const bindings: KeybindingsByMode = ownKeybindings(own);
  let mode = DEFAULT_MODE;

  const enter = (next: string) => {
    if (next !== mode) {
      mode = next;
      onModeChanged(next);
    }
  };

  const onShortcut = ({ chord }: { readonly chord: string }) => {
    const action = bindings.get(mode)?.get(chord);
    switch (action?.kind) {
      case KeyActionKind.SendShell: {
        onCommand(action.args);
        break;
      }
      case KeyActionKind.Mode: {
        enter(action.name);
        break;
      }
      case undefined: {
        break;
      }
    }
  };

  for (const chord of new Set(
    [...bindings.values()].flatMap((byChord) => [...byChord.keys()]),
  )) {
    try {
      domicile.grabShortcut(chord);
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: a keysym this keyboard cannot type is the user's to fix, and the console is where a shell says so
      console.error(error);
    }
  }
  domicile.addEventListener("shortcut", onShortcut);
  return {
    setMode: (name) => {
      if (bindings.has(name)) {
        mode = name;
      } else {
        enter(DEFAULT_MODE);
      }
    },
    unbind: () => {
      domicile.removeEventListener("shortcut", onShortcut);
    },
  };
};
