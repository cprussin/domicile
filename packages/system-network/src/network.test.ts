import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DbusBody,
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { Network } from "./network";
import { Connectivity, Link, watchNetwork } from "./network";

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

const SERVICE_UNKNOWN: SystemError = {
  kind: SystemErrorKind.Dbus,
  message:
    "org.freedesktop.DBus.Error.ServiceUnknown: The name is not activatable",
};

type Objects = Map<string, Result<DbusBody, SystemError>>;

/**
 * The system bus as the library sees it: `GetAll` answers from `objects`,
 * keyed by path, and the test sends signals to the match. A match fails with
 * `refused` when it is given.
 */
const fakeBus = (objects: Objects, refused?: SystemError) => {
  const calls: DbusCall[] = [];
  const matches: DbusMatch[] = [];
  const signals =
    Promise.withResolvers<ReadableStreamDefaultController<DbusSignal>>();
  const ended = Promise.withResolvers<Result<"stopped", SystemError>>();
  const items = new ReadableStream<DbusSignal>({
    start: (controller) => {
      signals.resolve(controller);
    },
  });
  const state = { stopped: 0 };
  return {
    break: async (error: SystemError) => {
      (await signals.promise).close();
      ended.resolve(Err(error));
    },
    calls,
    matches,
    send: async (path: string) => {
      (await signals.promise).enqueue({
        body: ["org.freedesktop.NetworkManager.AccessPoint", {}, []],
        interface: "org.freedesktop.DBus.Properties",
        member: "PropertiesChanged",
        path,
        sender: ":1.7",
        signature: "sa{sv}as",
      });
    },
    get stopped() {
      return state.stopped;
    },
    system: {
      dbusCall: (call: DbusCall) => {
        calls.push(call);
        const reply = objects.get(call.path);
        if (reply === undefined) {
          throw new Error(`test: no object at ${call.path}`);
        } else {
          return Promise.resolve(reply);
        }
      },
      dbusMatch: (match: DbusMatch) => {
        matches.push(match);
        return Promise.resolve(
          refused === undefined
            ? Ok<Listening<DbusSignal>, SystemError>({
                ended: ended.promise,
                items,
                stop: () => {
                  state.stopped += 1;
                  signals.promise
                    .then((controller) => {
                      controller.close();
                      ended.resolve(Ok("stopped"));
                    })
                    .catch(() => {
                      /* the test fails on the missing report instead */
                    });
                },
              })
            : Err<Listening<DbusSignal>, SystemError>(refused),
        );
      },
    },
  };
};

/** The reports a watch makes, read one at a time. */
const reports = () => {
  const queue: Result<Network, SystemError>[] = [];
  const waiting: ((report: Result<Network, SystemError>) => void)[] = [];
  return {
    next: (): Promise<Result<Network, SystemError>> => {
      const report = queue.shift();
      return report === undefined
        ? new Promise((resolve) => {
            waiting.push(resolve);
          })
        : Promise.resolve(report);
    },
    on: (report: Result<Network, SystemError>) => {
      const resolve = waiting.shift();
      if (resolve === undefined) {
        queue.push(report);
      } else {
        resolve(report);
      }
    },
    get pending() {
      return queue.length;
    },
  };
};

const wifi = (strength: number): Objects =>
  new Map([
    [ROOT, Ok(recorded.root(4, ACTIVE))],
    [ACTIVE, Ok(recorded.active("Home", "802-11-wireless", ACCESS_POINT))],
    [ACCESS_POINT, Ok(recorded.accessPoint(strength))],
  ]);

describe("watchNetwork", () => {
  describe("the primary connection", () => {
    it("reads a Wi-Fi network's name and signal", async () => {
      const bus = fakeBus(wifi(72));
      const seen = reports();

      watchNetwork(bus.system, seen.on);

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
      const bus = fakeBus(
        new Map<string, Result<DbusBody, SystemError>>([
          [ROOT, Ok(recorded.root(4, ACTIVE))],
          [
            ACTIVE,
            Ok(recorded.active("Wired connection 1", "802-3-ethernet", "/")),
          ],
        ]),
      );
      const seen = reports();

      watchNetwork(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({
          connectivity: Connectivity.Full,
          link: Link.Wired("Wired connection 1"),
        }),
      );
    });

    it("reads any other kind, such as a VPN, by its name", async () => {
      const bus = fakeBus(
        new Map<string, Result<DbusBody, SystemError>>([
          [ROOT, Ok(recorded.root(3, ACTIVE))],
          [ACTIVE, Ok(recorded.active("wg0", "wireguard", "/"))],
        ]),
      );
      const seen = reports();

      watchNetwork(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Limited, link: Link.Other("wg0") }),
      );
    });

    it("reads no link when there is no primary connection", async () => {
      const bus = fakeBus(
        new Map<string, Result<DbusBody, SystemError>>([
          [ROOT, Ok(recorded.root(1, "/"))],
        ]),
      );
      const seen = reports();

      watchNetwork(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.None, link: Link.None() }),
      );
    });
  });

  it("reports the error when NetworkManager is not running", async () => {
    const bus = fakeBus(
      new Map<string, Result<DbusBody, SystemError>>([
        [ROOT, Err(SERVICE_UNKNOWN)],
      ]),
    );
    const seen = reports();

    watchNetwork(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
  });

  describe("changes", () => {
    it("listens to NetworkManager's property changes", async () => {
      const bus = fakeBus(wifi(72));
      const seen = reports();

      watchNetwork(bus.system, seen.on);
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
      const bus = fakeBus(objects);
      const seen = reports();
      watchNetwork(bus.system, seen.on);
      await seen.next();

      objects.set(ACCESS_POINT, Ok(recorded.accessPoint(41)));
      await bus.send(ACCESS_POINT);

      expect(await seen.next()).toStrictEqual(
        Ok({ connectivity: Connectivity.Full, link: Link.Wifi("Home", 0.41) }),
      );
    });

    it("ignores objects the network it shows does not use", async () => {
      const objects = wifi(72);
      const bus = fakeBus(objects);
      const seen = reports();
      watchNetwork(bus.system, seen.on);
      await seen.next();

      await bus.send(OTHER_ACCESS_POINT);
      await bus.send(ROOT);
      await seen.next();

      // One read of three calls at the start, and one for the root.
      expect(bus.calls).toHaveLength(6);
    });

    it("reports the error when it cannot listen", async () => {
      const bus = fakeBus(wifi(72), SERVICE_UNKNOWN);
      const seen = reports();

      watchNetwork(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    });

    it("reports the error when the match breaks", async () => {
      const bus = fakeBus(wifi(72));
      const seen = reports();
      watchNetwork(bus.system, seen.on);
      await seen.next();

      await bus.break(SERVICE_UNKNOWN);

      expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    });
  });

  it("stops listening, and reports nothing more, once stopped", async () => {
    const bus = fakeBus(wifi(72));
    const seen = reports();
    const stop = watchNetwork(bus.system, seen.on);
    await seen.next();

    // A change arrives, and the watch stops while it reads again.
    await bus.send(ACCESS_POINT);
    stop();
    await Bun.sleep(0);

    expect(bus.stopped).toBe(1);
    expect(seen.pending).toBe(0);
  });

  it("stops a match that starts after the watch was stopped", async () => {
    const bus = fakeBus(wifi(72));
    const seen = reports();

    watchNetwork(bus.system, seen.on)();
    await Bun.sleep(0);

    expect(bus.stopped).toBe(1);
    expect(seen.pending).toBe(0);
  });
});
