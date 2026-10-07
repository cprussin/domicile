import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DbusBody,
  DbusCall,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";

import {
  fakeBus,
  propertiesChanged,
  reports,
  SERVICE_UNKNOWN,
} from "./fake-bus";
import { watchIwd } from "./iwd";
import { Connectivity, Link } from "./network-state";

const STATION = "/net/connman/iwd/0/4";
const OTHER_STATION = "/net/connman/iwd/1/7";
const HOME = "/net/connman/iwd/0/4/486f6d65_psk";
const CAFE = "/net/connman/iwd/0/4/43616665_open";

/** iwd's objects as the compositor writes `GetManagedObjects`, trimmed. */
const recorded = {
  network: (name: string, type: string) => ({
    "net.connman.iwd.Network": {
      Connected: { signature: "b", value: false },
      Device: { signature: "o", value: STATION },
      Name: { signature: "s", value: name },
      Type: { signature: "s", value: type },
    },
  }),
  orderedNetworks: (rssi: number): DbusBody => ({
    body: [
      [
        [HOME, rssi],
        [CAFE, -8100],
      ],
    ],
    signature: "a(on)",
  }),
  station: (state: string, connected?: string) => ({
    "net.connman.iwd.Device": {
      Mode: { signature: "s", value: "station" },
      Name: { signature: "s", value: "wlan0" },
      Powered: { signature: "b", value: true },
    },
    "net.connman.iwd.Station": {
      ...(connected === undefined
        ? {}
        : { ConnectedNetwork: { signature: "o", value: connected } }),
      Scanning: { signature: "b", value: false },
      State: { signature: "s", value: state },
    },
  }),
};

type Stations = Record<string, ReturnType<typeof recorded.station>>;

const managedObjects = (stations: Stations): DbusBody => ({
  body: [
    {
      "/net/connman/iwd": {
        "net.connman.iwd.Daemon": {},
      },
      "/net/connman/iwd/0": {
        "net.connman.iwd.Adapter": {
          Powered: { signature: "b", value: true },
        },
      },
      ...stations,
      [CAFE]: recorded.network("Cafe", "open"),
      [HOME]: recorded.network("Home", "psk"),
    },
  ],
  signature: "a{oa{sa{sv}}}",
});

/** iwd's replies: its objects, and each station's ordered networks. */
const iwd = (objects: () => Result<DbusBody, SystemError>, rssi = -6400) =>
  fakeBus((call: DbusCall) => {
    switch (call.member) {
      case "GetManagedObjects": {
        return objects();
      }
      case "GetOrderedNetworks": {
        return Ok(recorded.orderedNetworks(rssi));
      }
      default: {
        throw new Error(`test: no reply to ${call.member}`);
      }
    }
  });

const connected = (): Result<DbusBody, SystemError> =>
  Ok(managedObjects({ [STATION]: recorded.station("connected", HOME) }));

describe("watchIwd", () => {
  describe("the station", () => {
    it("reads the connected network's name and signal", async () => {
      const bus = iwd(connected);
      const seen = reports();

      watchIwd(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.6),
        }),
      );
      expect(bus.calls).toStrictEqual([
        {
          bus: Bus.System,
          destination: "net.connman.iwd",
          interface: "org.freedesktop.DBus.ObjectManager",
          member: "GetManagedObjects",
          path: "/",
        },
        {
          bus: Bus.System,
          destination: "net.connman.iwd",
          interface: "net.connman.iwd.Station",
          member: "GetOrderedNetworks",
          path: STATION,
        },
      ]);
    });

    it.each([
      ["connected", Link.Wifi("Home", 0.6)],
      ["roaming", Link.Wifi("Home", 0.6)],
      ["connecting", Link.None()],
      ["disconnecting", Link.None()],
      ["disconnected", Link.None()],
    ])("reads a station that is %s", async (state, link) => {
      const bus = iwd(() =>
        Ok(
          managedObjects({
            [STATION]: recorded.station(
              state,
              state === "disconnected" ? undefined : HOME,
            ),
          }),
        ),
      );
      const seen = reports();

      watchIwd(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Unknown, link }),
      );
    });

    it("reads the station that is connected when there are several", async () => {
      const bus = iwd(
        () =>
          Ok(
            managedObjects({
              [OTHER_STATION]: recorded.station("disconnected"),
              [STATION]: recorded.station("connected", HOME),
            }),
          ),
        -5200,
      );
      const seen = reports();

      watchIwd(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.8),
        }),
      );
    });
  });

  it("reports the error when iwd is not running", async () => {
    const bus = iwd(() => Err(SERVICE_UNKNOWN));
    const seen = reports();

    watchIwd(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
  });

  describe("changes", () => {
    it("listens to iwd's signals", async () => {
      const bus = iwd(connected);
      const seen = reports();

      watchIwd(bus.system, seen.on);
      await seen.next();

      expect(bus.matches).toStrictEqual([
        { bus: Bus.System, sender: "net.connman.iwd" },
      ]);
    });

    it("reads again when a station's state changes", async () => {
      const objects = { reply: connected() };
      const bus = iwd(() => objects.reply);
      const seen = reports();
      watchIwd(bus.system, seen.on);
      await seen.next();

      objects.reply = Ok(
        managedObjects({ [STATION]: recorded.station("disconnected") }),
      );
      await bus.send(
        propertiesChanged(STATION, "net.connman.iwd.Station", {
          State: { signature: "s", value: "disconnected" },
        }),
      );

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Unknown, link: Link.None() }),
      );
    });

    it("reads again when an object comes or goes", async () => {
      const bus = iwd(connected);
      const seen = reports();
      watchIwd(bus.system, seen.on);
      await seen.next();

      await bus.send({
        body: [OTHER_STATION, {}],
        interface: "org.freedesktop.DBus.ObjectManager",
        member: "InterfacesAdded",
        path: "/",
        sender: ":1.4",
        signature: "oa{sa{sv}}",
      });

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Unknown,
          link: Link.Wifi("Home", 0.6),
        }),
      );
    });

    it("reads again after a scan, and ignores other changes", async () => {
      const bus = iwd(connected);
      const seen = reports();
      watchIwd(bus.system, seen.on);
      await seen.next();

      await bus.send(
        propertiesChanged(STATION, "net.connman.iwd.Device", {
          Powered: { signature: "b", value: true },
        }),
      );
      await bus.send(
        propertiesChanged(STATION, "net.connman.iwd.Station", {
          Scanning: { signature: "b", value: false },
        }),
      );
      await seen.next();

      // One read of two calls at the start, and one after the scan.
      expect(bus.calls).toHaveLength(4);
    });
  });
});
