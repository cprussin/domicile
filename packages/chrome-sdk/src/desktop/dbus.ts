// D-Bus, which the compositor speaks for the shell on either bus. See
// docs/SHELL-SYSTEM-ACCESS.md.

import type { System } from "./system-calls";

export type Dbus = {
  call: System["dbusCall"];
  /** Hear each signal that matches, until stopped. */
  match: System["dbusMatch"];
};

export const dbus = (calls: Pick<System, "dbusCall" | "dbusMatch">): Dbus => ({
  call: (call) => calls.dbusCall(call),
  match: (match) => calls.dbusMatch(match),
});
