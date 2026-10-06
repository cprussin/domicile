// Grabs and handles a shell's keybindings.
//
// `grabShortcut` takes each chord by name; the engine finds its key and sends
// every press, from a `<webview>` or the page, as a `shortcut` event carrying
// the chord.
//
// Binding modes are tracked here; the engine does not know about them. See
// docs/architecture/KEYBINDINGS.md.

import type { DomicileHost } from "./domicile-host";
import { KeyActionKind } from "./key-action";
import type { KeybindingsByMode, ShellKeybindings } from "./own-keybindings";
import { ownKeybindings } from "./own-keybindings";

/** The initial binding mode. */
const DEFAULT_MODE = "default";

/** Callbacks {@link bindKeys} calls. */
export type KeyHandlers = {
  /** A `send-shell` binding was pressed, with its arguments. */
  onCommand: (args: readonly string[]) => void;
  /** The binding mode changed. */
  onModeChanged: (mode: string) => void;
};

/** The handle {@link bindKeys} returns. */
export type KeyBinding = {
  /** Switch to binding mode `name`; see {@link bindKeys}. */
  setMode: (name: string) => void;
  /** Stop handling keys. Grabs are not released. */
  unbind: () => void;
};

/** The part of `window.domicile` that `bindKeys` uses. */
export type KeyHost = Pick<
  DomicileHost,
  "addEventListener" | "grabShortcut" | "removeEventListener"
>;

/**
 * Handle the keybindings `own` for a shell.
 *
 * - Every chord in every mode is grabbed once. Grabs are never released, so a
 *   key bound in any mode is grabbed from all clients for the whole session.
 * - `setMode` syncs the mode across pages without calling `onModeChanged`. An
 *   unknown mode falls back to `default` and is reported.
 *
 * @throws for an invalid chord (see `ownKeybindings`), before anything is
 *   grabbed. A keysym the layout cannot type is logged, so the other keys
 *   still work.
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
      // biome-ignore lint/suspicious/noConsole: the user fixes a keysym the layout cannot type, so the shell reports it
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
