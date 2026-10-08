import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind, system } from "@domicile-desktop/sdk/system";
import type {
  Wifi,
  WifiConnection,
  WifiNetwork,
} from "@domicile-desktop/system-network/wifi";
import { WifiBackend } from "@domicile-desktop/system-network/wifi";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { heldWifiActions } from "./held-wifi-actions";
import { WifiPanel } from "./WifiPanel";

/** A host the panel never calls, since the library is injected. */
const NO_HOST = system(new FakeDomicileHost().host);

const DEVICE = "/org/freedesktop/NetworkManager/Devices/3";

const network = (ssid: string, changes: Partial<WifiNetwork>): WifiNetwork => ({
  connected: false,
  path: `/ap/${ssid}`,
  profile: undefined,
  secured: true,
  ssid,
  strength: 0.5,
  ...changes,
});

const home = network("Home", {
  connected: true,
  profile: "/profile/home",
  strength: 0.72,
});
const office = network("Office", { profile: "/profile/office", strength: 0.6 });
const cafe = network("Cafe", { secured: false, strength: 0.55 });
const neighbor = network("Neighbor", { strength: 0.2 });

const WIFI: Wifi = {
  backend: WifiBackend.NetworkManager,
  connection: {
    bitrate: 866.7,
    frequency: 5180,
    ip: {
      addresses: ["192.168.1.23/24"],
      dns: ["192.168.1.1", "1.1.1.1"],
      gateway: "192.168.1.1",
    },
    ssid: "Home",
    strength: 0.72,
  },
  device: DEVICE,
  enabled: true,
  hardwareAddress: "A4:C3:F0:85:AC:2D",
  interface: "wlan0",
  networks: [home, office, cafe, neighbor],
  scanning: false,
};

const REFUSED: SystemError = {
  kind: SystemErrorKind.Dbus,
  message: "org.freedesktop.NetworkManager.Device.NoSecrets: wrong passphrase",
};

/** The panel, once the scan it sends on showing has settled. */
const shown = async (
  wifi: Result<Option<Wifi>, SystemError> | undefined,
  held = heldWifiActions(),
) => {
  const rendered = render(
    <WifiPanel actions={held.actions} host={NO_HOST} wifi={wifi} />,
  );
  await act(() => Promise.resolve());
  return { ...held, ...rendered };
};

/** The panel, connected with `changes` to the connection. */
const shownWith = (changes: Partial<WifiConnection>) => {
  if (WIFI.connection === undefined) {
    throw new Error("test: WIFI is connected");
  } else {
    return shown(
      Ok(Some({ ...WIFI, connection: { ...WIFI.connection, ...changes } })),
    );
  }
};

/** The list item that names `ssid`. */
const row = (ssid: string) => {
  const found = screen.getByText(ssid).closest("li");
  if (found === null) {
    throw new Error(`test: no row for ${ssid}`);
  } else {
    return within(found);
  }
};

describe("WifiPanel", () => {
  it.each([
    [
      "the switch",
      "setEnabled",
      () => screen.getByRole("switch", { name: "Wi-Fi" }),
    ],
    ["a scan", "scan", () => screen.getByRole("button", { name: "Scan" })],
    [
      "disconnecting",
      "disconnect",
      () => screen.getByRole("button", { name: "Disconnect" }),
    ],
  ])("shows the service's refusal of %s", async (_name, refused, control) => {
    await shown(
      Ok(Some(WIFI)),
      heldWifiActions(([name]) =>
        name === refused ? Err(REFUSED) : Ok("done"),
      ),
    );

    await userEvent.click(control());

    expect(screen.getByText(REFUSED.message)).toBeVisible();
  });

  describe("before Wi-Fi is read", () => {
    it.each<[string, Result<Option<Wifi>, SystemError> | undefined, string]>([
      ["while it reads", undefined, "Reading Wi-Fi…"],
      ["without a device", Ok(None()), "No Wi-Fi device"],
      ["on a failure", Err(REFUSED), REFUSED.message],
    ])("says so %s", async (_when, wifi, text) => {
      await shown(wifi);

      expect(screen.getByText(text)).toBeVisible();
    });
  });

  describe("its switch", () => {
    it("turns the radio off", async () => {
      const panel = await shown(Ok(Some(WIFI)));

      await userEvent.click(screen.getByRole("switch", { name: "Wi-Fi" }));

      expect(panel.asked).toContainEqual(["setEnabled", DEVICE, false]);
    });

    it("says the radio is off, and lists and scans nothing", async () => {
      const panel = await shown(
        Ok(
          Some({
            ...WIFI,
            connection: undefined,
            enabled: false,
            networks: [],
          }),
        ),
      );

      expect(screen.getByRole("switch", { name: "Wi-Fi" })).not.toBeChecked();
      expect(screen.getByText("Wi-Fi is off")).toBeVisible();
      expect(panel.asked).toStrictEqual([]);
    });
  });

  describe("scanning", () => {
    it("scans when shown, and again on request", async () => {
      const panel = await shown(Ok(Some(WIFI)));
      expect(panel.asked).toStrictEqual([["scan", DEVICE]]);

      await userEvent.click(screen.getByRole("button", { name: "Scan" }));

      expect(panel.asked).toStrictEqual([
        ["scan", DEVICE],
        ["scan", DEVICE],
      ]);
    });

    it("says when it is scanning", async () => {
      await shown(Ok(Some({ ...WIFI, scanning: true })));

      expect(screen.getByText("Scanning…")).toBeVisible();
    });
  });

  describe("the connection", () => {
    it("shows its details", async () => {
      await shown(Ok(Some(WIFI)));
      const connection = within(
        screen.getByRole("region", { name: "Connected to Home" }),
      );

      expect(
        connection
          .getAllByRole("term")
          .map((term) => [
            term.textContent,
            term.nextElementSibling?.textContent,
          ]),
      ).toStrictEqual([
        ["Signal", "72%"],
        ["Frequency", "5180 MHz (5 GHz)"],
        ["Speed", "867 Mbit/s"],
        ["Address", "192.168.1.23/24"],
        ["Gateway", "192.168.1.1"],
        ["DNS", "192.168.1.1, 1.1.1.1"],
        ["Interface", "wlan0"],
        ["Hardware address", "A4:C3:F0:85:AC:2D"],
      ]);
    });

    it.each([
      [2412, "2412 MHz (2.4 GHz)"],
      [5955, "5955 MHz (6 GHz)"],
    ])("names %d MHz's band", async (frequency, shown) => {
      await shownWith({ frequency });

      expect(screen.getByText(shown)).toBeVisible();
    });

    it("leaves out what the service does not report", async () => {
      await shown(
        Ok(
          Some({
            ...WIFI,
            connection: {
              bitrate: undefined,
              frequency: undefined,
              ip: undefined,
              ssid: "Home",
              strength: 0.72,
            },
          }),
        ),
      );

      expect(
        screen.getAllByRole("term").map((term) => term.textContent),
      ).toStrictEqual(["Signal", "Interface", "Hardware address"]);
    });

    it("disconnects", async () => {
      const panel = await shown(Ok(Some(WIFI)));

      await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));

      expect(panel.asked.slice(1)).toStrictEqual([["disconnect", DEVICE]]);
    });
  });

  describe("the networks", () => {
    it("lists the others, strongest first, marking saved and secured ones", async () => {
      await shown(Ok(Some(WIFI)));

      expect(
        within(screen.getByRole("list", { name: "Networks" }))
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toStrictEqual([
        "Office, saved, secured, fair signal",
        "Cafe, fair signal",
        "Neighbor, secured, weak signal",
      ]);
    });

    it.each([
      ["a saved network", "Office"],
      ["an open network", "Cafe"],
    ])("joins %s on a click", async (_name, ssid) => {
      const panel = await shown(Ok(Some(WIFI)));

      await userEvent.click(row(ssid).getByRole("button"));

      expect(panel.asked.slice(1)).toStrictEqual([
        ["connect", DEVICE, ssid, undefined],
      ]);
    });

    it("asks for a new secured network's passphrase", async () => {
      const panel = await shown(Ok(Some(WIFI)));

      await userEvent.click(row("Neighbor").getByRole("button"));
      await userEvent.type(
        screen.getByLabelText("Passphrase for Neighbor"),
        "hunter22{Enter}",
      );

      expect(panel.asked.slice(1)).toStrictEqual([
        ["connect", DEVICE, "Neighbor", "hunter22"],
      ]);
    });

    it("says a network is connecting until the service answers", async () => {
      const held = heldWifiActions();
      const answer = Promise.withResolvers<Result<"done", SystemError>>();
      await shown(Ok(Some(WIFI)), {
        ...held,
        actions: { ...held.actions, connectWifi: () => answer.promise },
      });

      await userEvent.click(row("Office").getByRole("button"));

      expect(row("Office").getByText("Connecting…")).toBeVisible();
    });

    it("shows the service's refusal on the network's row", async () => {
      await shown(
        Ok(Some(WIFI)),
        heldWifiActions(([name]) =>
          name === "connect" ? Err(REFUSED) : Ok("done"),
        ),
      );

      await userEvent.click(row("Office").getByRole("button"));

      expect(row("Office").getByText(REFUSED.message)).toBeVisible();
    });
  });
});
