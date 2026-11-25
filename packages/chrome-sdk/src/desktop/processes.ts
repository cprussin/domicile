// Programs on the machine running the desktop, started by the compositor.
// See docs/SHELL-SYSTEM-ACCESS.md.

import type { DomicileHost } from "../domicile-host";
import type { System } from "./system-calls";

export type Processes = {
  /** Run `argv` with its streams, as a {@link System.spawn}. */
  spawn: System["spawn"];
  /** Run `argv` and collect its output as text once it ends. */
  run: System["run"];
  /**
   * Start `argv`, such as an application, and leave it running on its own.
   * `from` names where the launch started, such as `"launcher"`; the window
   * that answers it says so in its `launchedFrom`.
   */
  launch: (argv: readonly string[], from?: string) => void;
};

export const processes = (
  host: Pick<DomicileHost, "spawn">,
  calls: Pick<System, "run" | "spawn">,
): Processes => ({
  ...processCalls(calls),
  launch: (argv, from) => {
    if (from === undefined) {
      host.spawn(argv);
    } else {
      host.spawn(argv, from);
    }
  },
});

/** The calls that wait on a process, which an app module has too. */
export const processCalls = (
  calls: Pick<System, "run" | "spawn">,
): Omit<Processes, "launch"> => ({
  run: (argv, options) => calls.run(argv, options),
  spawn: (argv, options) => calls.spawn(argv, options),
});
