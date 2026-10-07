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
import { watchNetworkManager } from "./networkmanager";

const ROOT = "/org/freedesktop/NetworkManager";
const ACTIVE = "/org/freedesktop/NetworkManager/ActiveConnection/3";
const ACCESS_POINT = "/org/freedesktop/NetworkManager/AccessPoint/12";
const OTHER_ACCESS_POINT = "/org/freedesktop/NetworkManager/AccessPoint/13";

/** `Properties.GetAll` bodies as the compositor writes them, trimmed. */
const recorded = {
  accessPoint: (strength: number): DbusBody => ({
    body: [
      {
        Frequency: { signature: "u", value: 5180 },
        Ssid: { signature: "ay", value: [72, 111, 109, 101] },
        Strength: { signature: "y", value: strength },
      },
    ],
    signature: "a{sv}",
  }),
  active: (id: string, type: string, specific: string): DbusBody => ({
    body: [
      {
        Id: { signature: "s", value: id },
        SpecificObject: { signature: "o", value: specific },
        State: { signature: "u", value: 2 },
        Type: { signature: "s", value: type },
      },
    ],
    signature: "a{sv}",
  }),
  root: (connectivity: number, primary: string): DbusBody => ({
    body: [
      {
        Connectivity: { signature: "u", value: connectivity },
        NetworkingEnabled: { signature: "b", value: true },
        PrimaryConnection: { signature: "o", value: primary },
        PrimaryConnectionType: { signature: "s", value: "802-11-wireless" },
      },
    ],
    signature: "a{sv}",
  }),
};

/** NetworkManager's objects, by path. */
const nmBus = (objects: Objects, refused?: SystemError) =>
  fakeBus(byPath(objects), refused);

const wifi = (strength: number): Objects =>
  new Map([
    [ROOT, Ok(recorded.root(4, ACTIVE))],
    [ACTIVE, Ok(recorded.active("Home", "802-11-wireless", ACCESS_POINT))],
    [ACCESS_POINT, Ok(recorded.accessPoint(strength))],
  ]);

describe("watchNetworkManager", () => {
  describe("the primary connection", () => {
    it("reads a Wi-Fi network's name and signal", async () => {
      const bus = nmBus(wifi(72));
      const seen = reports();

      watchNetworkManager(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Full, link: Link.Wifi("Home", 0.72) }),
      );
      expect(bus.calls.map(({ interface: _, ...call }) => call)).toStrictEqual(
        [ROOT, ACTIVE, ACCESS_POINT].map((path, index) => ({
          body: [
            [
              "org.freedesktop.NetworkManager",
              "org.freedesktop.NetworkManager.Connection.Active",
              "org.freedesktop.NetworkManager.AccessPoint",
            ][index],
          ],
          bus: Bus.System,
          destination: "org.freedesktop.NetworkManager",
          member: "GetAll",
          path,
          signature: "s",
        })),
      );
    });

    it("reads a wired connection by its name", async () => {
      const bus = nmBus(
        new Map<string, Result<DbusBody, SystemError>>([
          [ROOT, Ok(recorded.root(4, ACTIVE))],
          [
            ACTIVE,
            Ok(recorded.active("Wired connection 1", "802-3-ethernet", "/")),
          ],
        ]),
      );
      const seen = reports();

      watchNetworkManager(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Full,
          link: Link.Wired("Wired connection 1"),
        }),
      );
    });

    it("reads any other kind, such as a VPN, by its name", async () => {
      const bus = nmBus(
        new Map<string, Result<DbusBody, SystemError>>([
          [ROOT, Ok(recorded.root(3, ACTIVE))],
          [ACTIVE, Ok(recorded.active("wg0", "wireguard", "/"))],
        ]),
      );
      const seen = reports();

      watchNetworkManager(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Limited, link: Link.Other("wg0") }),
      );
    });

    it("reads no link when there is no primary connection", async () => {
      const bus = nmBus(
        new Map<string, Result<DbusBody, SystemError>>([
          [ROOT, Ok(recorded.root(1, "/"))],
        ]),
      );
      const seen = reports();

      watchNetworkManager(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.None, link: Link.None() }),
      );
    });
  });

  it("reports the error when NetworkManager is not running", async () => {
    const bus = nmBus(
      new Map<string, Result<DbusBody, SystemError>>([
        [ROOT, Err(SERVICE_UNKNOWN)],
      ]),
    );
    const seen = reports();

    watchNetworkManager(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
  });

  describe("changes", () => {
    it("listens to NetworkManager's property changes", async () => {
      const bus = nmBus(wifi(72));
      const seen = reports();

      watchNetworkManager(bus.system, seen.on);
      await seen.next();

      expect(bus.matches).toStrictEqual([
        {
          bus: Bus.System,
          interface: "org.freedesktop.DBus.Properties",
          member: "PropertiesChanged",
          sender: "org.freedesktop.NetworkManager",
        },
      ]);
    });

    it("reads again when the connection's access point changes", async () => {
      const objects = wifi(72);
      const bus = nmBus(objects);
      const seen = reports();
      watchNetworkManager(bus.system, seen.on);
      await seen.next();

      objects.set(ACCESS_POINT, Ok(recorded.accessPoint(41)));
      await bus.send(
        propertiesChanged(
          ACCESS_POINT,
          "org.freedesktop.NetworkManager.AccessPoint",
          {},
        ),
      );

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Full, link: Link.Wifi("Home", 0.41) }),
      );
    });

    it("ignores objects the network it shows does not use", async () => {
      const objects = wifi(72);
      const bus = nmBus(objects);
      const seen = reports();
      watchNetworkManager(bus.system, seen.on);
      await seen.next();

      await bus.send(
        propertiesChanged(
          OTHER_ACCESS_POINT,
          "org.freedesktop.NetworkManager.AccessPoint",
          {},
        ),
      );
      await bus.send(
        propertiesChanged(
          ROOT,
          "org.freedesktop.NetworkManager.AccessPoint",
          {},
        ),
      );
      await seen.next();

      // One read of three calls at the start, and one for the root.
      expect(bus.calls).toHaveLength(6);
    });

    it("reports the error when it cannot listen", async () => {
      const bus = nmBus(wifi(72), SERVICE_UNKNOWN);
      const seen = reports();

      watchNetworkManager(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    });

    it("reports the error when the match breaks", async () => {
      const bus = nmBus(wifi(72));
      const seen = reports();
      watchNetworkManager(bus.system, seen.on);
      await seen.next();

      await bus.break(SERVICE_UNKNOWN);

      expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    });
  });

  it("stops listening, and reports nothing more, once stopped", async () => {
    const bus = nmBus(wifi(72));
    const seen = reports();
    const stop = watchNetworkManager(bus.system, seen.on);
    await seen.next();

    // A change arrives, and the watch stops while it reads again.
    await bus.send(
      propertiesChanged(
        ACCESS_POINT,
        "org.freedesktop.NetworkManager.AccessPoint",
        {},
      ),
    );
    stop();
    await Bun.sleep(0);

    expect(bus.stopped).toBe(1);
    expect(seen.pending).toBe(0);
  });

  it("stops a match that starts after the watch was stopped", async () => {
    const bus = nmBus(wifi(72));
    const seen = reports();

    watchNetworkManager(bus.system, seen.on)();
    await Bun.sleep(0);

    expect(bus.stopped).toBe(1);
    expect(seen.pending).toBe(0);
  });
});
