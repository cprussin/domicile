import type { KeyBinding } from "@domicile/sdk/bind-keys";
import { bindKeys } from "@domicile/sdk/bind-keys";
import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { ShellKeybindings } from "@domicile/sdk/own-keybindings";
import { useEffect, useEffectEvent, useRef } from "react";

import type { WindowAction } from "../window-management/window-state";
import { WindowActionKind } from "../window-management/window-state";
import { parseCommand } from "./command";

/** Where a command a binding names and this desktop does not know is said. */
const logToConsole = (error: string): void => {
  // biome-ignore lint/suspicious/noConsole: the bindings are the user's, and the console is where a shell tells them one named nothing
  console.error(error);
};

type Options = {
  domicile: DomicileClient;
  /** The keys this desktop binds. */
  keybindings: ShellKeybindings;
  /** Whether the launcher is up, which silences every key but its own. */
  launcherOpen: boolean;
  /**
   * The binding mode the desk is in, which the keys this page hears are read
   * in — whichever page's key entered it.
   */
  mode: string;
  /** What the desktop is being asked to do. */
  onAction: (action: WindowAction) => void;
  /** A key on this page entered a binding mode. */
  onModeChanged: (mode: string) => void;
  /** Where an unknown command is reported. Injected so a test can read it. */
  report?: typeof logToConsole;
};

/**
 * The keys this desktop binds, answered.
 *
 * The SDK claims every chord, hears each press by whichever path it took, and
 * reads it in the binding mode; what is left here is what manganese means by
 * `send-shell <words>` — see `command.ts` — the launcher's modality, and the
 * mode itself, which is the desk's rather than this page's.
 *
 * **THE MODE SPANS THE DESK.** A desk of several monitors is several pages,
 * and the key that entered resize mode may have landed on another one than
 * the next key does. So a mode a key enters goes out as `onModeChanged`, into
 * the desktop every page shares, and the mode that desktop is in comes back as
 * `mode` and is handed to the SDK — on this page and every other.
 *
 * Bound once per client and set of keys, not once per render: the keyboard
 * arrives once and again only when it changes, so a binding torn down and
 * made again would miss it. `keybindings` is a shell's options, made once. What changes between renders is read when a key is pressed.
 *
 */
export const useKeybindings = ({
  domicile,
  keybindings,
  launcherOpen,
  mode,
  onAction,
  onModeChanged,
  report = logToConsole,
}: Options): void => {
  const binding = useRef<KeyBinding | undefined>(undefined);

  const onCommand = useEffectEvent((args: readonly string[]) => {
    parseCommand(args).match({
      Err: report,
      Ok: (action) => {
        if (!launcherOpen || heardOverLauncher(action)) {
          onAction(action);
        }
      },
    });
  });

  const modeChanged = useEffectEvent((entered: string) => {
    onModeChanged(entered);
  });

  useEffect(() => {
    const bound = bindKeys(domicile, keybindings, {
      onCommand,
      onModeChanged: modeChanged,
    });
    binding.current = bound;
    return bound.unbind;
  }, [domicile, keybindings]);

  // After the binding above, which effects run in order of: the first mode
  // reaches a binding that exists.
  useEffect(() => {
    binding.current?.setMode(mode);
  }, [mode]);
};

/**
 * Whether a press is answered while the launcher is up.
 *
 * Only its own key is, which is what closes it. The panel is modal, and a
 * workspace switched or a window killed behind it is the desktop reacting to
 * keys somebody pressed at the panel.
 */
const heardOverLauncher = (action: WindowAction): boolean =>
  action.kind === WindowActionKind.LauncherToggled;
