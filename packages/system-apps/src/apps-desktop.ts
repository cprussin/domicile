// The parts of the desktop the apps library reads through.

import type { Dbus } from "@domicile-desktop/sdk/desktop/dbus";
import type { Files } from "@domicile-desktop/sdk/desktop/files";
import type { Processes } from "@domicile-desktop/sdk/desktop/processes";

/** What the library calls: files and processes, and D-Bus for the icon theme. */
export type AppsDesktop = {
  readonly dbus: Pick<Dbus, "call">;
  readonly files: Pick<Files, "read" | "readDir" | "readText" | "stat">;
  readonly processes: Pick<Processes, "run" | "spawn">;
};
