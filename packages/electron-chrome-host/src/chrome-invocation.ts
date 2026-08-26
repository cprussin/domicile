// How a shell starts its own Electron process, once the compositor is up.
//
// Two things have to be settled before Electron initialises rather than after:
// which display its window goes on, and which platform it draws through. Both
// are decided by a compositor that did not exist when the shell was started —
// which is why the shell's launcher is a plain Node process that starts the
// compositor first and Electron second, rather than an Electron app that tries
// to change its own mind.

import type { CompositorSession } from "./compositor-session";
import { sessionDocument } from "./compositor-session";

/** The environment as a process has it, which is all-optional by nature. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** The switch that keeps Electron off X11 when there is a Wayland desktop to be in. */
const OZONE_WAYLAND = "--ozone-platform=wayland";

/**
 * What makes the *launcher* a Node process rather than an Electron one.
 *
 * Set by a shell's `bin` stub, and it must not reach the chrome: inherited, it
 * would run `main.js` as an ordinary ES module, where `import { ipcMain } from
 * "electron"` is a missing export and the desktop dies before its window
 * exists.
 */
const RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";

/**
 * The environment to start the chrome's Electron process with.
 *
 * `WAYLAND_DISPLAY` only when the compositor is drawing: otherwise the chrome's
 * window is an ordinary one on whatever desktop the user is already running,
 * and pointing it at a compositor that composites nothing gives it a display
 * with no screen behind it.
 */
export const chromeEnvironment = (
  session: CompositorSession,
  base: Environment,
): Environment => {
  const { [RUN_AS_NODE]: _ranAsNode, ...inherited } = base;
  return {
    ...inherited,
    ...(session.composited
      ? { WAYLAND_DISPLAY: session.chromeWaylandDisplay }
      : {}),
    DOMICILE_SESSION: sessionDocument(session),
  };
};

/**
 * The arguments to start the chrome's Electron process with.
 *
 * `extra` is the machine's, not the shell's: a nix store build carries no
 * setuid sandbox helper and needs `--no-sandbox`, and a shell that could name
 * its own flags could turn its own sandbox off.
 */
export const chromeArguments = (
  session: CompositorSession,
  extra: readonly string[],
): string[] => [...(session.composited ? [OZONE_WAYLAND] : []), ...extra];

/**
 * An environment variable holding a command line, as arguments.
 *
 * Split on whitespace and nothing cleverer: this carries a packager's
 * `--no-sandbox`, not a shell expression, and a quoting rule invented here
 * would be one more thing for a machine's configuration to get wrong.
 */
export const argumentsFrom = (value: string | undefined): string[] =>
  value === undefined || value.trim() === "" ? [] : value.trim().split(/\s+/u);
