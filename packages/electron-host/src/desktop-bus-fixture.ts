// A desktop session bus for tests: a private dbus-daemon serving a stand-in
// settings portal with the appearance a test gives, and a notification server
// that writes down each notification.

import {
  DBusError,
  interface as dbusInterface,
  sessionBus,
  Variant,
} from "dbus-next";

/** The portal's `org.freedesktop.appearance` values. */
export type PortalAppearance = { colorScheme: number; contrast: number };

/** A notification the server was sent: its summary, body and hints' values. */
export type SentNotification = {
  appName: string;
  summary: string;
  body: string;
  actions: string[];
  hints: Record<string, unknown>;
};

class Settings extends dbusInterface.Interface {
  constructor(private readonly appearance: PortalAppearance) {
    super("org.freedesktop.portal.Settings");
  }

  ReadOne(namespace: string, key: string) {
    if (namespace === "org.freedesktop.appearance" && key === "color-scheme") {
      return new Variant("u", this.appearance.colorScheme);
    } else if (
      namespace === "org.freedesktop.appearance" &&
      key === "contrast"
    ) {
      return new Variant("u", this.appearance.contrast);
    } else {
      throw new DBusError(
        "org.freedesktop.portal.Error.NotFound",
        `no ${namespace} ${key}`,
      );
    }
  }
}

Settings.configureMembers({
  methods: { ReadOne: { inSignature: "ss", outSignature: "v" } },
  signals: { SettingChanged: { signature: "ssv" } },
});

class Notifications extends dbusInterface.Interface {
  readonly sent: SentNotification[] = [];

  constructor() {
    super("org.freedesktop.Notifications");
  }

  Notify(
    appName: string,
    _replaces: number,
    _icon: string,
    summary: string,
    body: string,
    actions: string[],
    hints: Record<string, Variant>,
    _timeout: number,
  ) {
    this.sent.push({
      actions,
      appName,
      body,
      hints: Object.fromEntries(
        Object.entries(hints).map(([key, { value }]) => [key, value]),
      ),
      summary,
    });
    return this.sent.length;
  }

  CloseNotification(_id: number) {
    // Nothing to take down: nothing is drawn.
  }
}

Notifications.configureMembers({
  methods: {
    CloseNotification: { inSignature: "u", outSignature: "" },
    Notify: { inSignature: "susssasa{sv}i", outSignature: "u" },
  },
  signals: {
    ActionInvoked: { signature: "us" },
    NotificationClosed: { signature: "uu" },
    NotificationReplied: { signature: "us" },
  },
});

/** Starts the bus and its services; `address` goes in DBUS_SESSION_BUS_ADDRESS. */
export const startFakeDesktopBus = async (appearance: PortalAppearance) => {
  const daemon = Bun.spawn(
    ["dbus-daemon", "--session", "--nofork", "--print-address=1"],
    { stderr: "inherit", stdin: "ignore", stdout: "pipe" },
  );
  const reader = daemon.stdout.getReader();
  let printed = "";
  while (!printed.includes("\n")) {
    const { done, value } = await reader.read();
    if (done) {
      throw new Error("test: dbus-daemon exited before printing its address");
    }
    printed += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const address = printed.trim();
  const bus = sessionBus({ busAddress: address });
  await bus.requestName("org.freedesktop.portal.Desktop", 0);
  await bus.requestName("org.freedesktop.Notifications", 0);
  const notifications = new Notifications();
  bus.export("/org/freedesktop/portal/desktop", new Settings(appearance));
  bus.export("/org/freedesktop/Notifications", notifications);
  return {
    address,
    close: async () => {
      bus.disconnect();
      daemon.kill();
      await daemon.exited;
    },
    /** Each notification the server was sent, in order. */
    notifications: notifications.sent,
  };
};
