// Resolves, grabs and handles a shell's keybindings.
//
// A press arrives by one of two paths. In a `<webview>`, the browser process
// matches the grab and sends a `shortcut` message. Everywhere else, including
// over an `<app>`, it is a `keydown` on this document; the grab stops the SDK
// forwarding it to the window. Both are handled here.
//
// Binding modes are tracked here; the compositor does not know about them. See
// docs/architecture/KEYBINDINGS.md.

import type { DomicileClient } from "./domicile-client";
import type {
  HostMessageOf,
  HostMessageType,
  KeybindingsByMode,
  ShellConfigMessage,
  ShortcutMessage,
} from "./host-message";
import { evdevFromCode } from "./input";
import { KeyActionKind } from "./key-action";
import { actionFor, sameChord } from "./keybindings";
import type { ShellKeybindings } from "./own-keybindings";
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

/** The part of a {@link DomicileClient} that `bindKeys` uses. */
type KeyClient = {
  grabShortcut: DomicileClient["grabShortcut"];
  on<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): unknown;
  off<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): unknown;
};

/**
 * Handle the keybindings `own` for a shell.
 *
 * - `own` is resolved against each `shell_config` keymap, so a layout change
 *   moves the keys. An invalid chord, or a keysym the layout cannot type,
 *   throws then.
 * - This takes the `shell_config` and `shortcut` handler slots; registering
 *   either elsewhere replaces it.
 * - Grabs are never released, because the protocol cannot release one. A key
 *   bound in any mode is grabbed from all clients for the whole session, and a
 *   key a layout change moved stays grabbed until the page reloads.
 * - `setMode` syncs the mode across pages without calling `onModeChanged`. An
 *   unknown mode falls back to `default` and is reported. Before the first
 *   keymap, the mode is checked once one arrives.
 * - Bind once per client. The keymap is sent only on connect and on change, so
 *   a rebind after `unbind` does nothing until the next change.
 *
 * @returns `unbind`, which stops handling keys but keeps the grabs, and
 *   `setMode`.
 */
export const bindKeys = (
  domicile: KeyClient,
  own: ShellKeybindings,
  { onCommand, onModeChanged }: KeyHandlers,
): KeyBinding => {
  // `undefined` until the first keymap, so an early `setMode` cannot be
  // checked.
  let bindings: KeybindingsByMode | undefined;
  let mode = DEFAULT_MODE;

  const enter = (next: string) => {
    if (next !== mode) {
      mode = next;
      onModeChanged(next);
    }
  };

  /** Run a press's action. Returns whether the press was bound. */
  const answer = (press: ShortcutMessage, repeat: boolean): boolean => {
    const action =
      bindings === undefined ? undefined : actionFor(bindings, mode, press);
    // Ignore repeats so both paths act once per press; the compositor never
    // sends repeats.
    if (action !== undefined && !repeat) {
      switch (action.kind) {
        case KeyActionKind.SendShell: {
          onCommand(action.args);
          break;
        }
        case KeyActionKind.Mode: {
          enter(action.name);
          break;
        }
      }
    }
    return action !== undefined;
  };

  const onConfig = (config: ShellConfigMessage) => {
    const bound = ownKeybindings(own, config.keys);
    bindings = bound;
    for (const chord of chordsOf(bound)) {
      domicile.grabShortcut(chord);
    }
    if (!bound.has(mode)) {
      enter(DEFAULT_MODE);
    }
  };

  const onShortcut = (press: ShortcutMessage) => {
    answer(press, false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const press = pressOf(event);
    // Prevent the default even for repeats, so a bound Tab does not move page
    // focus away from the window.
    if (press !== undefined && answer(press, event.repeat)) {
      event.preventDefault();
    }
  };

  domicile.on("shell_config", onConfig);
  domicile.on("shortcut", onShortcut);
  document.addEventListener("keydown", onKeyDown);
  return {
    setMode: (name) => {
      if (bindings !== undefined && !bindings.has(name)) {
        enter(DEFAULT_MODE);
      } else {
        mode = name;
      }
    },
    unbind: () => {
      document.removeEventListener("keydown", onKeyDown);
      domicile.off("shortcut", onShortcut);
      domicile.off("shell_config", onConfig);
    },
  };
};

/** Every chord bound in any mode, each once. */
const chordsOf = (bindings: KeybindingsByMode): readonly ShortcutMessage[] =>
  [...bindings.values()]
    .flat()
    .map(({ shortcut }) => shortcut)
    .filter(
      (chord, at, all) =>
        all.findIndex((other) => sameChord(other, chord)) === at,
    );

/**
 * Convert a `keydown` to a chord, or `undefined` for a key with no evdev code.
 */
const pressOf = (event: KeyboardEvent): ShortcutMessage | undefined => {
  const keycode = evdevFromCode(event.code);
  if (keycode === undefined) {
    return undefined;
  } else {
    return {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      keycode,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
  }
};
