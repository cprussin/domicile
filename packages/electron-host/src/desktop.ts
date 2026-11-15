// What the host reaches on the desktop itself: commands and the session bus.
// Thin on purpose; what reads their answers is tested on its own.

import { sessionBus } from "dbus-next";

import type { PortalSettings } from "./appearance";
import type { Run } from "./electron/shell";

/** Runs `command`, answering its exit code and its output, both streams. */
export const runCommand: Run = async (command) => {
  const child = Bun.spawn([...command], {
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: `${out}${err}` };
};

/** The desktop's settings portal, on the session bus at `address`. */
export const portalSettings = async (
  address: string,
): Promise<PortalSettings> => {
  const portal = await sessionBus({ busAddress: address }).getProxyObject(
    "org.freedesktop.portal.Desktop",
    "/org/freedesktop/portal/desktop",
  );
  // dbus-next types a proxy's methods loosely; ReadOne and SettingChanged
  // are the portal's, typed as `PortalSettings` says.
  return portal.getInterface(
    "org.freedesktop.portal.Settings",
  ) as unknown as PortalSettings;
};
