// A desktop session bus for tests: a private dbus-daemon serving a stand-in
// settings portal with the appearance a test gives.

import {
  DBusError,
  interface as dbusInterface,
  sessionBus,
  Variant,
} from "dbus-next";

/** The portal's `org.freedesktop.appearance` values. */
export type PortalAppearance = { colorScheme: number; contrast: number };

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

/** Starts the bus and the portal; `address` goes in DBUS_SESSION_BUS_ADDRESS. */
export const startFakePortal = async (appearance: PortalAppearance) => {
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
  bus.export("/org/freedesktop/portal/desktop", new Settings(appearance));
  return {
    address,
    close: async () => {
      bus.disconnect();
      daemon.kill();
      await daemon.exited;
    },
  };
};
