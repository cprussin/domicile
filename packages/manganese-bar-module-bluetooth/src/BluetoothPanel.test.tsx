import { describe, expect, it, spyOn } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind, system } from "@domicile-desktop/sdk/system";
import type {
  Bluetooth,
  Device,
} from "@domicile-desktop/system-bluetooth/bluetooth";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BluetoothPanel } from "./BluetoothPanel";
import type { Asked } from "./held-actions";
import { heldActions } from "./held-actions";

/** A host the panel never calls, since the library is injected. */
const NO_HOST = system(new FakeDomicileHost().host);

const ADAPTER = "/org/bluez/hci0";

const device = (name: string, changes: Partial<Device>): Device => ({
  adapter: ADAPTER,
  address: "AC:80:0A:1B:2C:3D",
  battery: undefined,
  connected: false,
  name,
  paired: true,
  path: `${ADAPTER}/dev_${name}`,
  ...changes,
});

const speaker = device("Kitchen", {
  address: "10:94:97:2A:3B:4C",
  paired: false,
});
const mouse = device("MX Master 3", { address: "F4:73:35:4E:5F:60" });
const headphones = device("WH-1000XM4", { battery: 80, connected: true });

const reading = (changes: Partial<Bluetooth> = {}): Bluetooth => ({
  adapters: [{ discovering: false, path: ADAPTER, powered: true }],
  devices: [speaker, mouse, headphones],
  ...changes,
});

const shown = (bluetooth: Bluetooth, held = heldActions()) => ({
  ...held,
  ...render(
    <BluetoothPanel
      actions={held.actions}
      bluetooth={bluetooth}
      host={NO_HOST}
    />,
  ),
});

/** The row that names `name`. */
const row = (name: string) => {
  const found = screen.getByText(name).closest("li");
  if (found === null) {
    throw new Error(`test: no row for ${name}`);
  } else {
    return within(found);
  }
};

describe("BluetoothPanel", () => {
  describe("its switch", () => {
    it("is on while an adapter is", () => {
      shown(reading());

      expect(screen.getByRole("switch", { name: "Bluetooth" })).toBeChecked();
    });

    it("turns every adapter off", async () => {
      const panel = shown(reading());

      await userEvent.click(screen.getByRole("switch", { name: "Bluetooth" }));

      expect(panel.asked).toContainEqual(["setPowered", ADAPTER, false]);
    });

    it("shows BlueZ's refusal", async () => {
      shown(
        reading(),
        heldActions(([name]) =>
          name === "setPowered"
            ? Err({
                kind: SystemErrorKind.Dbus,
                message: "org.bluez.Error.Blocked: Blocked through rfkill",
              })
            : Ok("done"),
        ),
      );

      await userEvent.click(screen.getByRole("switch", { name: "Bluetooth" }));

      expect(
        screen.getByText("org.bluez.Error.Blocked: Blocked through rfkill"),
      ).toBeVisible();
    });

    it("says it is off, and lists and scans nothing", () => {
      const panel = shown(
        reading({
          adapters: [{ discovering: false, path: ADAPTER, powered: false }],
        }),
      );

      expect(screen.getByText("Bluetooth is off")).toBeVisible();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(panel.asked).toStrictEqual([]);
    });
  });

  describe("scanning", () => {
    it("scans while shown, and stops when it goes away", () => {
      const panel = shown(reading());
      expect(panel.asked).toStrictEqual([["startDiscovery", ADAPTER]]);

      panel.unmount();

      expect(panel.asked).toStrictEqual([
        ["startDiscovery", ADAPTER],
        ["stopDiscovery", ADAPTER],
      ]);
    });

    it("logs BlueZ's refusal to scan", async () => {
      const refused: SystemError = {
        kind: SystemErrorKind.Dbus,
        message: "org.bluez.Error.NotReady: Resource Not Ready",
      };
      const logged = new Promise<unknown[]>((resolve) => {
        spyOn(console, "error").mockImplementationOnce((...args) => {
          resolve(args);
        });
      });

      shown(
        reading(),
        heldActions(([name]) =>
          name === "startDiscovery" ? Err(refused) : Ok("done"),
        ),
      );

      expect(await logged).toStrictEqual([
        "BlueZ refused to start scanning",
        refused,
      ]);
    });

    it("says when it is searching", () => {
      shown(
        reading({
          adapters: [{ discovering: true, path: ADAPTER, powered: true }],
        }),
      );

      expect(screen.getByText("Searching for devices…")).toBeVisible();
    });
  });

  describe("its devices", () => {
    it("lists connected, then paired, then new, with each one's details", () => {
      shown(reading());

      expect(
        screen.getAllByRole("listitem").map((item) => item.textContent),
      ).toStrictEqual([
        "WH-1000XM4Connected · Battery 80% · AC:80:0A:1B:2C:3DDisconnect",
        "MX Master 3Paired · F4:73:35:4E:5F:60Connect",
        "KitchenNew · 10:94:97:2A:3B:4CPair",
      ]);
    });

    it.each<[string, string, Asked[]]>([
      ["WH-1000XM4", "Disconnect", [["disconnect", headphones.path]]],
      ["MX Master 3", "Connect", [["connect", mouse.path]]],
      [
        "Kitchen",
        "Pair",
        [
          ["pair", speaker.path],
          ["connect", speaker.path],
        ],
      ],
    ])("%s's %s button asks BlueZ", async (name, button, asked) => {
      const panel = shown(reading());

      await userEvent.click(row(name).getByRole("button", { name: button }));

      expect(panel.asked.slice(1)).toStrictEqual(asked);
    });

    it("forgets a paired device", async () => {
      const panel = shown(reading());

      await userEvent.click(
        screen.getByRole("button", { name: "Forget MX Master 3" }),
      );

      expect(panel.asked.slice(1)).toStrictEqual([["forget", mouse.path]]);
    });

    it("shows BlueZ's refusal on the device's row", async () => {
      const refused: SystemError = {
        kind: SystemErrorKind.Dbus,
        message: "org.bluez.Error.Failed: Page Timeout",
      };
      shown(
        reading(),
        heldActions(([name]) =>
          name === "connect" ? Err(refused) : Ok("done"),
        ),
      );

      await userEvent.click(
        row("MX Master 3").getByRole("button", { name: "Connect" }),
      );

      expect(
        row("MX Master 3").getByText("org.bluez.Error.Failed: Page Timeout"),
      ).toBeVisible();
    });
  });
});
