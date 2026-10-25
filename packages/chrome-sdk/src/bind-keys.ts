// Grabs and handles a shell's keybindings.
//
// `grabShortcut` takes each chord by name; the engine finds its key and sends
// every press, from a `<webview>` or the page, as a `shortcut` event carrying
// the chord.
//
// Binding modes are tracked here; the engine does not know about them. A
// command typed as `domicile send-shell` arrives as a shell command system
// event and runs as its `SendShell` binding would. See
// docs/architecture/KEYBINDINGS.md.

import type { Keyboard } from "./desktop/keyboard";
import type { ShellNamespace } from "./desktop/shell";
import { KeyActionKind } from "./key-action";
import type { KeybindingsByMode, ShellKeybindings } from "./own-keybindings";
import { ownKeybindings } from "./own-keybindings";
import type { Listening, SystemError } from "./system";

/** The initial binding mode. */
const DEFAULT_MODE = "default";

/** Callbacks {@link bindKeys} calls. */
export type KeyHandlers = {
  /**
   * A `send-shell` binding was pressed, or `domicile send-shell` sent a
   * command, with its arguments.
   */
  onCommand: (args: readonly string[]) => void;
  /** The binding mode changed. */
  onModeChanged: (mode: string) => void;
  /** The page cannot hear `domicile send-shell`. Logs by default. */
  report?: (error: SystemError) => void;
};

/** The handle {@link bindKeys} returns. */
export type KeyBinding = {
  /** Switch to binding mode `name`; see {@link bindKeys}. */
  setMode: (name: string) => void;
  /** Stop handling keys, and give back every chord grabbed. */
  unbind: () => void;
};

/** The part of the desktop that `bindKeys` uses. */
export type KeyDesktop = {
  readonly keyboard: Pick<Keyboard, "grab" | "on" | "ungrab">;
  readonly shell: Pick<ShellNamespace, "commands">;
};

/**
 * Handle the keybindings `own` for a shell.
 *
 * - Every chord in every mode is grabbed once, until `unbind`. A key bound in
 *   any mode is grabbed from all clients while bound.
 * - `setMode` syncs the mode across pages without calling `onModeChanged`. An
 *   unknown mode falls back to `default` and is reported.
 *
 * @throws for an invalid chord (see `ownKeybindings`), before anything is
 *   grabbed. A keysym the layout cannot type is logged, so the other keys
 *   still work.
 */
export const bindKeys = (
  domicile: KeyDesktop,
  own: ShellKeybindings,
  { onCommand, onModeChanged, report = reportToConsole }: KeyHandlers,
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

  const grabbed = grabEach(
    domicile.keyboard,
    new Set([...bindings.values()].flatMap((byChord) => [...byChord.keys()])),
  );
  const stopShortcuts = domicile.keyboard.on("shortcut", onShortcut);
  const commands = hearCommands(domicile.shell, onCommand, report);
  return {
    setMode: (name) => {
      if (bindings.has(name)) {
        mode = name;
      } else {
        enter(DEFAULT_MODE);
      }
    },
    unbind: () => {
      stopShortcuts();
      commands.stop();
      // Emptied, so a second unbind does not answer somebody else's grab.
      for (const chord of grabbed.splice(0)) {
        domicile.keyboard.ungrab(chord);
      }
    },
  };
};

/**
 * Grab each of `chords`, and return those the engine took. A keysym the
 * layout cannot type is logged.
 */
const grabEach = (
  keyboard: Pick<Keyboard, "grab">,
  chords: Iterable<string>,
): string[] =>
  [...chords].filter((chord) => {
    try {
      keyboard.grab(chord);
      return true;
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: the user fixes a keysym the layout cannot type, so the shell reports it
      console.error(error);
      return false;
    }
  });

/** Log that `domicile send-shell` cannot reach this page. */
const reportToConsole = (error: SystemError): void => {
  // biome-ignore lint/suspicious/noConsole: the keys still work, and the console is where the shell says `domicile send-shell` cannot reach it
  console.error("this page cannot hear domicile send-shell", error);
};

/**
 * Run each command `domicile send-shell` sends through `onCommand`, until
 * `stop`. A stop before listening starts ends it once it does.
 */
const hearCommands = (
  shell: Pick<ShellNamespace, "commands">,
  onCommand: (args: readonly string[]) => void,
  report: (error: SystemError) => void,
): { stop: () => void } => {
  const state: {
    stopped: boolean;
    listening: Listening<readonly string[]> | undefined;
  } = { listening: undefined, stopped: false };
  shell
    .commands()
    .then((result) => {
      result.match({
        Err: report,
        Ok: (listening) => {
          if (state.stopped) {
            listening.stop();
          } else {
            state.listening = listening;
          }
          eachOf(listening.items, onCommand).catch(reportToConsole);
        },
      });
    })
    .catch(reportToConsole);
  return {
    stop: () => {
      state.stopped = true;
      state.listening?.stop();
    },
  };
};

/** Call `each` with every item `items` brings, until it closes. */
const eachOf = async <T>(
  items: ReadableStream<T>,
  each: (item: T) => void,
): Promise<void> => {
  for await (const item of items) {
    each(item);
  }
};
