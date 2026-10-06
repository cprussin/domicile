import type { KeyBinding } from "@domicile-desktop/sdk/bind-keys";
import { bindKeys } from "@domicile-desktop/sdk/bind-keys";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { useEffect, useEffectEvent, useRef } from "react";

import type { WindowAction } from "../window-management/window-state";
import { WindowActionKind } from "../window-management/window-state";
import { parseCommand } from "./command";

/** Report an unknown command. */
const logToConsole = (error: string): void => {
  // biome-ignore lint/suspicious/noConsole: the bindings are the user's, and the console is where a shell tells them one named nothing
  console.error(error);
};

type Options = {
  domicile: DomicileHost;
  /** The shell's keybindings. */
  keybindings: ShellKeybindings;
  /** Whether the launcher is open, which blocks every key but its own. */
  launcherOpen: boolean;
  /** The desk-wide binding mode, whichever page entered it. */
  mode: string;
  /** Receives the action a key asks for. */
  onAction: (action: WindowAction) => void;
  /** Called when a key on this page enters a binding mode. */
  onModeChanged: (mode: string) => void;
  /** Reports unknown commands. Injectable for tests. */
  report?: typeof logToConsole;
};

/**
 * Bind the shell's keys and dispatch their commands.
 *
 * The SDK grabs the chords and reads each `shortcut` in the binding mode. This
 * hook parses `send-shell` commands (see `command.ts`), blocks keys while the
 * launcher is open, and syncs the binding mode.
 *
 * The mode is desk-wide: each monitor is a separate page, so a mode entered on
 * one page goes out via `onModeChanged` and comes back to every page as
 * `mode`.
 *
 * Binds once per host and keybindings, not per render.
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

  // Must follow the binding effect, so the first mode reaches a live binding.
  useEffect(() => {
    binding.current?.setMode(mode);
  }, [mode]);
};

/**
 * Whether an action runs while the launcher is open.
 *
 * Only the launcher toggle does. The launcher is modal, so other keys must not
 * act on windows behind it.
 */
const heardOverLauncher = (action: WindowAction): boolean =>
  action.kind === WindowActionKind.LauncherToggled;
