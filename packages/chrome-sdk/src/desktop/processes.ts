// Programs on the machine running the desktop, started by the compositor.
// See docs/SHELL-SYSTEM-ACCESS.md.

import type { DomicileHost } from "../domicile-host";
import type { System } from "./system-calls";

export type Processes = {
  /** Run `argv` with its streams, as a {@link System.spawn}. */
  spawn: System["spawn"];
  /** Run `argv` and collect its output as text once it ends. */
  run: System["run"];
  /** Start `argv`, such as an application, and leave it running on its own. */
  launch: (argv: readonly string[]) => void;
};

export const processes = (
  host: Pick<DomicileHost, "spawn">,
  calls: Pick<System, "run" | "spawn">,
): Processes => ({
  ...processCalls(calls),
  launch: (argv) => {
    host.spawn(argv);
  },
});

/** The calls that wait on a process, which an app module has too. */
export const processCalls = (
  calls: Pick<System, "run" | "spawn">,
): Omit<Processes, "launch"> => ({
  run: (argv, options) => calls.run(argv, options),
  spawn: (argv, options) => calls.spawn(argv, options),
});
