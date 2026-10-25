// The desktop an app module is handed: the shell's system access without its
// window manager. See docs/architecture/APP-MODULES.md.

import type { DomicileAppHost } from "../domicile-host";
import type { Dbus } from "./dbus";
import { dbus } from "./dbus";
import type { Files } from "./files";
import { fileCalls } from "./files";
import type { Processes } from "./processes";
import { processCalls } from "./processes";
import { system } from "./system-calls";

/** What the compositor answers an app: anything else fails `permission_denied`. */
export type AppDomicile = {
  readonly dbus: Dbus;
  /** {@link Files} without `search`, which only a shell has. */
  readonly files: Omit<Files, "search">;
  /** {@link Processes} without `launch`, which only a shell has. */
  readonly processes: Omit<Processes, "launch">;
};

/** The desktop an app's `host` reaches. Build one per host. */
export const appDesktop = (host: DomicileAppHost): AppDomicile => {
  const calls = system(host);
  return {
    dbus: dbus(calls),
    files: fileCalls(calls),
    processes: processCalls(calls),
  };
};
