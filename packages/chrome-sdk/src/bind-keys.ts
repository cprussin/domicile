// A shell's keys, as the config binds them, answered.
//
// The compositor's config says what every key does — `"Meta+Return" =
// "send-shell terminal"` — and resolves each chord to a key on the live keymap
// before it sends them. What is left for a page is to claim them and answer
// them, and that is the same work for every shell, so it is here once.
//
// **Two paths, because two different things can be holding the keyboard.** A
// `<webview>` is a browsing context of its own, so a key pressed on a site the
// shell is showing reaches neither this document nor the compositor: the
// browser process matches the claim and hands it back as a `shortcut` message.
// Every other press lands on this document as a `keydown` — a Wayland window
// is an `<app>` element and DOM focus never leaves the page — and the claim is
// what keeps the SDK from forwarding the chord to that window on its way past.
// So any press arrives by exactly one of the two, and both are answered here.
//
// **Modes are the SDK's.** `mode resize` changes what the same keys do, and
// the compositor knows nothing about it, so the mode is tracked here and both
// paths read the keys in it. A shell is told the mode moved, to draw it; it is
// never asked to move it.

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
import { actionFor, keybindingsFor, sameChord } from "./keybindings";

/** The mode a desk starts in: the config's `[keybindings]`. */
const DEFAULT_MODE = "default";

/** What a shell is told as its keys are answered. */
export type KeyHandlers = {
  /** A `send-shell` binding was pressed: the words after `send-shell`. */
  onCommand: (args: readonly string[]) => void;
  /** The keys are read in another binding mode now. */
  onModeChanged: (mode: string) => void;
  /**
   * The shell's `[shells.<name>.options]` table, as unparsed JSON — `{}` when
   * the config has none — once per config the compositor sends.
   */
  onOptions: (options: unknown) => void;
};

/** What {@link bindKeys} hands back. */
export type KeyBinding = {
  /** Read the keys in `name` from now on — see {@link bindKeys}. */
  setMode: (name: string) => void;
  /** Stop answering. The claims stay. */
  unbind: () => void;
};

/**
 * What `bindKeys` uses of a client: a {@link DomicileClient}, or anything with
 * its handler slots and its claim.
 */
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
 * Answer the keys the config binds for the shell named `shell`: the desk's
 * `[keybindings]` and `[modes]`, with `[shells.<shell>]`'s on top.
 *
 * **This owns `shell_config` and `shortcut`.** {@link DomicileClient.on} is a
 * single slot per message, so a shell that registers either of its own
 * displaces this.
 *
 * **A claim is never given back.** Every chord of every mode is claimed as
 * each config arrives, because the channel has no way to release one — so a
 * reload that unbinds a chord leaves it the desktop's, answering nothing,
 * until the shell's page reloads. And for that reason, a bare key bound in a
 * mode is taken from every client for the whole session, not only while the
 * mode is on.
 *
 * **The mode is tracked here, and a shell can set it.** A desktop of several
 * pages shares one mode across them — a key that entered it may have landed on
 * another page — so `setMode` is how a page is told: the keys are read in that
 * mode from then on, and `onModeChanged` is not called for it, the shell
 * having said so itself. The mode the keys are already in does nothing; one
 * the config does not have goes back to `default`, as a config that drops the
 * mode does, and that is reported. Before any config, the mode is kept until
 * the config arrives and is checked then.
 *
 * **Bind once per client.** The config arrives once and again only when it
 * changes, so keys bound anew after an unbind answer nothing until the next
 * reload of it. A React shell binds in an effect that depends on the client
 * alone, and reads anything else it needs when a key is pressed.
 *
 * @returns `unbind`, which stops the answering — the claims stay, as above —
 *   and `setMode`.
 */
export const bindKeys = (
  domicile: KeyClient,
  shell: string,
  { onCommand, onModeChanged, onOptions }: KeyHandlers,
): KeyBinding => {
  // `undefined` until the first config: no key is bound yet, and a mode set
  // in the meantime cannot be checked against anything.
  let bindings: KeybindingsByMode | undefined;
  let mode = DEFAULT_MODE;

  const enter = (next: string) => {
    if (next !== mode) {
      mode = next;
      onModeChanged(next);
    }
  };

  /** What a press does, if anything: whether it was bound at all. */
  const answer = (press: ShortcutMessage, repeat: boolean): boolean => {
    const action =
      bindings === undefined ? undefined : actionFor(bindings, mode, press);
    // A held key repeats tens of times a second and the compositor never sees
    // a repeat at all, so one press does one thing on either path.
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
    const bound = keybindingsFor(config, shell);
    bindings = bound;
    for (const chord of chordsOf(bound)) {
      domicile.grabShortcut(chord);
    }
    if (!bound.has(mode)) {
      enter(DEFAULT_MODE);
    }
    onOptions(config.shells.get(shell)?.options ?? {});
  };

  const onShortcut = (press: ShortcutMessage) => {
    answer(press, false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const press = pressOf(event);
    // Taken from the page whether or not it acts: the chord is the desktop's
    // for as long as it is held, and Tab would otherwise walk the focus ring
    // out from under the window being worked in.
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
 * A key that went down on the page, in a binding's terms — or `undefined` for
 * a key with no evdev code, which no binding can name.
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
