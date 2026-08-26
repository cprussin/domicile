// The shell's entry point: what runs when the user runs the shell.
//
// A Domicile shell is not something the compositor starts. It is the program on
// the user's `PATH`, and the compositor is what it starts underneath itself —
// so as far as anyone using the desktop is concerned, the shell *is* the
// compositor, and Domicile is an implementation detail of it.
//
// This is a plain Node process rather than the Electron one because of the
// order things have to happen in: the chrome's window goes on a display the
// compositor names, and Electron settles which display it draws on while it
// starts up. Starting the compositor first and Electron second is what makes
// that knowable in time.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

import {
  argumentsFrom,
  chromeArguments,
  chromeEnvironment,
} from "./chrome-invocation";
import type { CompositorConfig } from "./compositor-config";
import { forwardStops } from "./forward-stops";
import { startCompositor } from "./start-compositor";
import { exitStatus } from "./stop-signals";

/** What Electron is called when nothing on the machine says otherwise. */
const ELECTRON = "electron";

/** What a shell tells its launcher. */
export type LaunchShellOptions = {
  /** The shell's Electron main bundle — the `main.js` its build emitted. */
  main: string;
  /**
   * Whether the desktop is on a screen.
   *
   * A shell for a session a user logs into wants `true`. `false` is the
   * headless arrangement, where client frames arrive as pixels for the page
   * to draw itself, and is mostly what the checks in this repo drive.
   */
  present: boolean;
  /**
   * What to tell the compositor about the desktop, derived from whatever the
   * shell's own users write. Omitted means the compositor's defaults.
   */
  config?: CompositorConfig | undefined;
  /** The compositor binary. Defaults to `$DOMICILE_COMPOSITOR`, then `PATH`. */
  compositor?: string | undefined;
  /** The Electron binary. Defaults to `$DOMICILE_ELECTRON`, then `PATH`. */
  electron?: string | undefined;
  /**
   * Extra arguments for Electron. Defaults to `$DOMICILE_ELECTRON_ARGS`, split
   * on whitespace. The machine's to say, not the shell's — a host that cannot
   * give Chromium a usable namespace sandbox needs `--no-sandbox`, and only
   * the machine knows whether it is one.
   */
  electronArgs?: readonly string[] | undefined;
};

/**
 * Run the shell: a compositor, and the chrome drawn inside it.
 *
 * Resolves with the chrome's exit status, which is the shell's own — it is the
 * program the user ran. Throws if the compositor never came up, carrying what
 * it said about why.
 */
export const launchShell = async ({
  compositor,
  config,
  electron,
  electronArgs,
  main,
  present,
}: LaunchShellOptions): Promise<number> => {
  // biome-ignore lint/style/noProcessEnv: this is the launcher; it is its own env.
  const environment = process.env;
  // Before anything is started, not after the compositor is up. Bringing a
  // compositor up takes seconds — a GPU probe, a socket bind — and a desktop
  // that has shown nothing yet is the one a user closes the terminal on. A
  // stop arriving in that window used to kill the launcher outright and leave
  // the compositor it had already spawned.
  const running: Running = {
    chrome: undefined,
    stopping: new AbortController(),
  };
  const release = forwardStops({
    end: () => {
      running.chrome?.kill("SIGKILL");
    },
    signal: (signal: NodeJS.Signals) => {
      // Whichever half exists. Before the chrome there is only a compositor,
      // and `startCompositor` takes the abort and tears its own run down.
      if (running.chrome === undefined) {
        running.stopping.abort(new Error(`domicile: stopped by ${signal}`));
      } else {
        running.chrome.kill(signal);
      }
    },
  });

  try {
    const started = await startCompositor({
      config,
      present,
      stopping: running.stopping.signal,
      ...(compositor === undefined ? {} : { program: compositor }),
    });
    try {
      return await runChrome(
        electron ?? environment.DOMICILE_ELECTRON ?? ELECTRON,
        [
          main,
          ...chromeArguments(
            started.session,
            electronArgs ?? argumentsFrom(environment.DOMICILE_ELECTRON_ARGS),
          ),
        ],
        chromeEnvironment(started.session, environment),
        running,
      );
    } finally {
      await started.stop();
    }
  } finally {
    release();
  }
};

/** The two halves of a desktop, as stopping one has to see them. */
type Running = {
  /** The chrome's process, once there is one. */
  chrome: ChildProcess | undefined;
  /** How a stop reaches the compositor while it is still coming up. */
  stopping: AbortController;
};

/** Run the chrome's Electron process to completion, and report how it went. */
const runChrome = (
  program: string,
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  running: Running,
): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: environment,
      stdio: "inherit",
    });
    // Published before anything can be forwarded to it, so a stop that lands
    // in the same tick as the spawn reaches the chrome rather than aborting a
    // compositor that is already up.
    running.chrome = child;
    child.on("error", reject);
    child.on("close", (code, signal) => {
      running.chrome = undefined;
      resolve(exitStatus(code, signal));
    });
  });
