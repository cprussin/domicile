// What the host reaches on the desktop itself: commands and the session bus.
// Thin on purpose; what reads their answers is tested on its own.

import { sessionBus, Variant } from "dbus-next";

import type { PortalSettings } from "./appearance";
import type { NotificationsBus } from "./electron/notification";
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

/** `org.freedesktop.Notifications` as dbus-next's proxy calls it. */
type NotificationsProxy = {
  readonly Notify: (
    appName: string,
    replaces: number,
    icon: string,
    summary: string,
    body: string,
    actions: readonly string[],
    hints: Record<string, Variant>,
    timeout: number,
  ) => Promise<number>;
  readonly CloseNotification: (id: number) => Promise<void>;
  readonly on: NotificationsBus["on"];
};

/**
 * The desktop's services on the session bus at `address`: the settings
 * portal and the notification server.
 */
export const connectDesktop = async (address: string) => {
  const bus = sessionBus({ busAddress: address });
  const [portal, server] = await Promise.all([
    bus.getProxyObject(
      "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop",
    ),
    bus.getProxyObject(
      "org.freedesktop.Notifications",
      "/org/freedesktop/Notifications",
    ),
  ]);
  // dbus-next types a proxy's members loosely; these are the services' own,
  // typed as the spec says.
  const settings = portal.getInterface(
    "org.freedesktop.portal.Settings",
  ) as unknown as PortalSettings;
  const notifications = server.getInterface(
    "org.freedesktop.Notifications",
  ) as unknown as NotificationsProxy;
  return {
    notifications: {
      close: (id) => notifications.CloseNotification(id),
      notify: (call) =>
        notifications.Notify(
          call.appName,
          call.replaces,
          call.icon,
          call.summary,
          call.body,
          call.actions,
          Object.fromEntries(
            Object.entries(call.hints).map(([key, [signature, value]]) => [
              key,
              new Variant(signature, value),
            ]),
          ),
          call.timeout,
        ),
      on: notifications.on.bind(notifications),
    } satisfies NotificationsBus,
    settings,
  };
};
