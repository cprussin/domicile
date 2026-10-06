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

import type { Bluetooth } from "./bluetooth";
import { setPowered, watchBluetooth } from "./bluetooth";

const ADAPTER = "/org/bluez/hci0";
const HEADPHONES = "/org/bluez/hci0/dev_AC_80_0A_1B_2C_3D";
const MOUSE = "/org/bluez/hci0/dev_F4_73_35_4E_5F_60";

/** `ObjectManager.GetManagedObjects` as the compositor writes it, trimmed. */
const recorded = (powered: boolean, mouse: boolean): DbusBody => ({
  body: [
    {
      "/org/bluez": {
        "org.bluez.AgentManager1": {},
        "org.freedesktop.DBus.Introspectable": {},
      },
      [ADAPTER]: {
        "org.bluez.Adapter1": {
          Address: { signature: "s", value: "00:1A:7D:DA:71:13" },
          Discovering: { signature: "b", value: false },
          Powered: { signature: "b", value: powered },
        },
        "org.freedesktop.DBus.Properties": {},
      },
      [HEADPHONES]: {
        "org.bluez.Battery1": { Percentage: { signature: "y", value: 80 } },
        "org.bluez.Device1": {
          Adapter: { signature: "o", value: ADAPTER },
          Address: { signature: "s", value: "AC:80:0A:1B:2C:3D" },
          Alias: { signature: "s", value: "WH-1000XM4" },
          Connected: { signature: "b", value: true },
          Paired: { signature: "b", value: true },
        },
      },
      [MOUSE]: {
        "org.bluez.Device1": {
          Adapter: { signature: "o", value: ADAPTER },
          Address: { signature: "s", value: "F4:73:35:4E:5F:60" },
          Alias: { signature: "s", value: "MX Master 3" },
          Connected: { signature: "b", value: mouse },
          Paired: { signature: "b", value: true },
        },
      },
    },
  ],
  signature: "a{oa{sa{sv}}}",
});

const SERVICE_UNKNOWN: SystemError = {
  kind: SystemErrorKind.Dbus,
  message:
    "org.freedesktop.DBus.Error.ServiceUnknown: The name is not activatable",
};

const properties = (iface: string, changed: object): DbusSignal => ({
  body: [iface, changed, []],
  interface: "org.freedesktop.DBus.Properties",
  member: "PropertiesChanged",
  path: MOUSE,
  sender: ":1.4",
  signature: "sa{sv}as",
});

/**
 * The system bus as the library sees it: each call answers the next of
 * `replies`, and the test sends signals to the match. A match fails with
 * `refused` when it is given.
 */
const fakeBus = (
  replies: Result<DbusBody, SystemError>[],
  refused?: SystemError,
) => {
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
    send: async (signal: DbusSignal) => {
      (await signals.promise).enqueue(signal);
    },
    get stopped() {
      return state.stopped;
    },
    system: {
      dbusCall: (call: DbusCall) => {
        calls.push(call);
        const reply = replies.shift();
        if (reply === undefined) {
          throw new Error(`test: no reply for ${call.member}`);
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
  const queue: Result<Bluetooth, SystemError>[] = [];
  const waiting: ((report: Result<Bluetooth, SystemError>) => void)[] = [];
  return {
    next: (): Promise<Result<Bluetooth, SystemError>> => {
      const report = queue.shift();
      return report === undefined
        ? new Promise((resolve) => {
            waiting.push(resolve);
          })
        : Promise.resolve(report);
    },
    on: (report: Result<Bluetooth, SystemError>) => {
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

const HEADPHONES_ONLY: Bluetooth = {
  adapters: [{ path: ADAPTER, powered: true }],
  connected: [{ name: "WH-1000XM4", path: HEADPHONES }],
};

describe("watchBluetooth", () => {
  it("reads each adapter and the devices connected", async () => {
    const bus = fakeBus([Ok(recorded(true, false))]);
    const seen = reports();

    watchBluetooth(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Ok(HEADPHONES_ONLY));
    expect(bus.calls).toStrictEqual([
      {
        bus: Bus.System,
        destination: "org.bluez",
        interface: "org.freedesktop.DBus.ObjectManager",
        member: "GetManagedObjects",
        path: "/",
      },
    ]);
  });

  it("reports the error when BlueZ is not running", async () => {
    const bus = fakeBus([Err(SERVICE_UNKNOWN)]);
    const seen = reports();

    watchBluetooth(bus.system, seen.on);

    expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
  });

  describe("changes", () => {
    it("listens to BlueZ", async () => {
      const bus = fakeBus([Ok(recorded(true, false))]);
      const seen = reports();

      watchBluetooth(bus.system, seen.on);
      await seen.next();

      expect(bus.matches).toStrictEqual([
        { bus: Bus.System, sender: "org.bluez" },
      ]);
    });

    it("reads again when a device connects", async () => {
      const bus = fakeBus([
        Ok(recorded(true, false)),
        Ok(recorded(true, true)),
      ]);
      const seen = reports();
      watchBluetooth(bus.system, seen.on);
      await seen.next();

      await bus.send(
        properties("org.bluez.Device1", {
          Connected: { signature: "b", value: true },
        }),
      );

      expect(await seen.next()).toStrictEqual(
        Ok({
          adapters: [{ path: ADAPTER, powered: true }],
          connected: [
            { name: "WH-1000XM4", path: HEADPHONES },
            { name: "MX Master 3", path: MOUSE },
          ],
        }),
      );
    });

    it("reads again when an adapter is turned off, and not for signal strength", async () => {
      const bus = fakeBus([
        Ok(recorded(true, false)),
        Ok(recorded(false, false)),
      ]);
      const seen = reports();
      watchBluetooth(bus.system, seen.on);
      await seen.next();

      await bus.send(
        properties("org.bluez.Device1", {
          RSSI: { signature: "n", value: -61 },
        }),
      );
      await bus.send(
        properties("org.bluez.Adapter1", {
          Powered: { signature: "b", value: false },
        }),
      );

      expect(await seen.next()).toStrictEqual(
        Ok({
          adapters: [{ path: ADAPTER, powered: false }],
          connected: [{ name: "WH-1000XM4", path: HEADPHONES }],
        }),
      );
      expect(bus.calls).toHaveLength(2);
    });

    it("reads again when an object comes or goes", async () => {
      const bus = fakeBus([
        Ok(recorded(true, false)),
        Ok(recorded(true, false)),
      ]);
      const seen = reports();
      watchBluetooth(bus.system, seen.on);
      await seen.next();

      await bus.send({
        body: [MOUSE, ["org.bluez.Device1"]],
        interface: "org.freedesktop.DBus.ObjectManager",
        member: "InterfacesRemoved",
        path: "/",
        sender: ":1.4",
        signature: "oas",
      });

      expect(await seen.next()).toStrictEqual(Ok(HEADPHONES_ONLY));
    });

    it("reports the error when it cannot listen", async () => {
      const bus = fakeBus([Ok(recorded(true, false))], SERVICE_UNKNOWN);
      const seen = reports();

      watchBluetooth(bus.system, seen.on);

      expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    });

    it("reports the error when the match breaks", async () => {
      const bus = fakeBus([Ok(recorded(true, false))]);
      const seen = reports();
      watchBluetooth(bus.system, seen.on);
      await seen.next();

      await bus.break(SERVICE_UNKNOWN);

      expect(await seen.next()).toStrictEqual(Err(SERVICE_UNKNOWN));
    });
  });

  describe("stopping", () => {
    it("stops listening, and reports nothing more", async () => {
      const bus = fakeBus([
        Ok(recorded(true, false)),
        Ok(recorded(true, true)),
      ]);
      const seen = reports();
      const stop = watchBluetooth(bus.system, seen.on);
      await seen.next();

      // A change arrives, and the watch stops while it reads again.
      await bus.send(
        properties("org.bluez.Device1", {
          Connected: { signature: "b", value: true },
        }),
      );
      stop();
      await Bun.sleep(0);

      expect(bus.stopped).toBe(1);
      expect(seen.pending).toBe(0);
    });

    it("stops a match that starts after the watch was stopped", async () => {
      const bus = fakeBus([Ok(recorded(true, false))]);
      const seen = reports();

      watchBluetooth(bus.system, seen.on)();
      await Bun.sleep(0);

      expect(bus.stopped).toBe(1);
      expect(seen.pending).toBe(0);
    });
  });
});

describe("setPowered", () => {
  it("sets the adapter's Powered property", async () => {
    const bus = fakeBus([Ok({ body: [], signature: "" })]);

    expect(await setPowered(bus.system, ADAPTER, false)).toStrictEqual(
      Ok("set"),
    );
    expect(bus.calls).toStrictEqual([
      {
        body: [
          "org.bluez.Adapter1",
          "Powered",
          { signature: "b", value: false },
        ],
        bus: Bus.System,
        destination: "org.bluez",
        interface: "org.freedesktop.DBus.Properties",
        member: "Set",
        path: ADAPTER,
        signature: "ssv",
      },
    ]);
  });

  it("reports BlueZ's refusal", async () => {
    const blocked: SystemError = {
      kind: SystemErrorKind.Dbus,
      message: "org.bluez.Error.Blocked: Blocked through rfkill",
    };
    const bus = fakeBus([Err(blocked)]);

    expect(await setPowered(bus.system, ADAPTER, true)).toStrictEqual(
      Err(blocked),
    );
  });
});
