import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { DbusBody, SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";

import type { Objects } from "./fake-bus";
import {
  byPath,
  fakeBus,
  propertiesChanged,
  reports,
  SERVICE_UNKNOWN,
} from "./fake-bus";
import { Connectivity, Link } from "./network-state";
import { watchWpaSupplicant } from "./wpa-supplicant";

const ROOT = "/fi/w1/wpa_supplicant1";
const WLAN0 = "/fi/w1/wpa_supplicant1/Interfaces/0";
const WLAN1 = "/fi/w1/wpa_supplicant1/Interfaces/1";
const BSS = "/fi/w1/wpa_supplicant1/Interfaces/0/BSSs/12";
const OTHER_BSS = "/fi/w1/wpa_supplicant1/Interfaces/0/BSSs/13";

/** `Properties.GetAll` bodies as the compositor writes them, trimmed. */
const recorded = {
  bss: (signal: number): DbusBody => ({
    body: [
      {
        BSSID: { signature: "ay", value: [2, 0, 0, 0, 1, 0] },
        Frequency: { signature: "q", value: 5180 },
        Signal: { signature: "n", value: signal },
        SSID: { signature: "ay", value: [72, 111, 109, 101] },
      },
    ],
    signature: "a{sv}",
  }),
  iface: (state: string, bss: string): DbusBody => ({
    body: [
      {
        CurrentBSS: { signature: "o", value: bss },
        Ifname: { signature: "s", value: "wlan0" },
        Scanning: { signature: "b", value: false },
        State: { signature: "s", value: state },
      },
    ],
    signature: "a{sv}",
  }),
  root: (interfaces: string[]): DbusBody => ({
    body: [
      {
        DebugLevel: { signature: "s", value: "info" },
        Interfaces: { signature: "ao", value: interfaces },
      },
    ],
    signature: "a{sv}",
  }),
};

const completed = (signal = -64): Objects =>
  new Map<string, Result<DbusBody, SystemError>>([
    [ROOT, Ok(recorded.root([WLAN0]))],
    [WLAN0, Ok(recorded.iface("completed", BSS))],
    [BSS, Ok(recorded.bss(signal))],
  ]);

describe("watchWpaSupplicant", () => {
  describe("the interface", () => {
    it("reads the current network's name and signal", async () => {
      const bus = fakeBus(byPath(completed()));
      const seen = reports();

      watchWpaSupplicant(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.6),
        }),
      );
      expect(bus.calls).toStrictEqual(
        (
          [
            [ROOT, "fi.w1.wpa_supplicant1"],
            [WLAN0, "fi.w1.wpa_supplicant1.Interface"],
            [BSS, "fi.w1.wpa_supplicant1.BSS"],
          ] as const
        ).map(([path, interfaceName]) => ({
          body: [interfaceName],
          bus: Bus.System,
          destination: "fi.w1.wpa_supplicant1",
          interface: "org.freedesktop.DBus.Properties",
          member: "GetAll",
          path,
          signature: "s",
        })),
      );
    });

    it.each([
      ["completed", Link.Wifi("Home", 0.6)],
      ["group_handshake", Link.Wifi("Home", 0.6)],
      ["4way_handshake", Link.None()],
      ["associated", Link.None()],
      ["associating", Link.None()],
      ["authenticating", Link.None()],
      ["scanning", Link.None()],
      ["inactive", Link.None()],
      ["disconnected", Link.None()],
      ["interface_disabled", Link.None()],
      ["unknown", Link.None()],
    ])("reads an interface that is %s", async (state, link) => {
      const objects = completed();
      objects.set(WLAN0, Ok(recorded.iface(state, BSS)));
      const bus = fakeBus(byPath(objects));
      const seen = reports();

      watchWpaSupplicant(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Unknown, link }),
      );
    });

    it("reads the interface that is connected when there are several", async () => {
      const bus = fakeBus(
        byPath(
          new Map<string, Result<DbusBody, SystemError>>([
            [ROOT, Ok(recorded.root([WLAN1, WLAN0]))],
            [WLAN1, Ok(recorded.iface("disconnected", "/"))],
            [WLAN0, Ok(recorded.iface("completed", BSS))],
            [BSS, Ok(recorded.bss(-52))],
          ]),
        ),
      );
      const seen = reports();

      watchWpaSupplicant(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.8),
        }),
      );
    });
  });

  it("reports the error when wpa_supplicant is not on the bus", async () => {
    const bus = fakeBus(
      byPath(
        new Map<string, Result<DbusBody, SystemError>>([
          [ROOT, Err(SERVICE_UNKNOWN)],
        ]),
      ),
    );
    const seen = reports();

    watchWpaSupplicant(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
  });

  describe("changes", () => {
    it("listens to wpa_supplicant's signals", async () => {
      const bus = fakeBus(byPath(completed()));
      const seen = reports();

      watchWpaSupplicant(bus.system, seen.on);
      await seen.next();

      expect(bus.matches).toStrictEqual([
        { bus: Bus.System, sender: "fi.w1.wpa_supplicant1" },
      ]);
    });

    it("reads again when the network's signal changes", async () => {
      const objects = completed();
      const bus = fakeBus(byPath(objects));
      const seen = reports();
      watchWpaSupplicant(bus.system, seen.on);
      await seen.next();

      objects.set(BSS, Ok(recorded.bss(-52)));
      await bus.send(
        propertiesChanged(BSS, "fi.w1.wpa_supplicant1.BSS", {
          Signal: { signature: "n", value: -52 },
        }),
      );

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.8),
        }),
      );
    });

    it("stays on the network through a group rekey", async () => {
      const objects = completed();
      const bus = fakeBus(byPath(objects));
      const seen = reports();
      watchWpaSupplicant(bus.system, seen.on);
      await seen.next();

      objects.set(WLAN0, Ok(recorded.iface("group_handshake", BSS)));
      await bus.send(
        propertiesChanged(WLAN0, "fi.w1.wpa_supplicant1.Interface", {
          State: { signature: "s", value: "group_handshake" },
        }),
      );

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.6),
        }),
      );
    });

    it("reads again when an interface is added", async () => {
      const bus = fakeBus(byPath(completed()));
      const seen = reports();
      watchWpaSupplicant(bus.system, seen.on);
      await seen.next();

      await bus.send({
        body: [WLAN1, {}],
        interface: "fi.w1.wpa_supplicant1",
        member: "InterfaceAdded",
        path: ROOT,
        sender: ":1.9",
        signature: "oa{sv}",
      });

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.6),
        }),
      );
    });

    it("ignores objects it did not read, and the old change signal", async () => {
      const bus = fakeBus(byPath(completed()));
      const seen = reports();
      watchWpaSupplicant(bus.system, seen.on);
      await seen.next();

      await bus.send(
        propertiesChanged(OTHER_BSS, "fi.w1.wpa_supplicant1.BSS", {}),
      );
      await bus.send({
        ...propertiesChanged(WLAN0, "fi.w1.wpa_supplicant1.Interface", {}),
        body: [{ State: { signature: "s", value: "completed" } }],
        interface: "fi.w1.wpa_supplicant1.Interface",
        signature: "a{sv}",
      });
      await bus.send(
        propertiesChanged(WLAN0, "fi.w1.wpa_supplicant1.Interface", {}),
      );
      await seen.next();

      // One read of three calls at the start, and one for the interface.
      expect(bus.calls).toHaveLength(6);
    });
  });
});
