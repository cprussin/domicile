import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type {
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus, SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Battery } from "./battery";
import { readBattery, watchBattery } from "./battery";

const DEVICE = "/org/freedesktop/UPower/devices/DisplayDevice";

/** UPower's `GetAll` reply for a DisplayDevice, as recorded on a laptop. */
const displayDevice = (
  overrides: Record<string, { signature: string; value: unknown }> = {},
) => ({
  body: [
    {
      Energy: { signature: "d", value: 41.2 },
      IconName: { signature: "s", value: "battery-full-symbolic" },
      IsPresent: { signature: "b", value: true },
      Percentage: { signature: "d", value: 87.3 },
      State: { signature: "u", value: 2 },
      Type: { signature: "u", value: 2 },
      ...overrides,
    },
  ],
  signature: "a{sv}",
});

/** A `PropertiesChanged` signal from the DisplayDevice. */
const changed = (
  properties: Record<string, { signature: string; value: unknown }>,
  iface = "org.freedesktop.UPower.Device",
): DbusSignal => ({
  body: [iface, properties, []],
  interface: "org.freedesktop.DBus.Properties",
  member: "PropertiesChanged",
  path: DEVICE,
  sender: ":1.12",
  signature: "sa{sv}as",
});

const LOCKED: SystemError = {
  kind: SystemErrorKind.Locked,
  message: "the desktop is locked",
};

/**
 * The system bus as UPower answers it: `GetAll` returns `reply`, and a match
 * hands over the signals `signal` sends.
 */
const upower = (
  reply: ReturnType<typeof displayDevice> | SystemError = displayDevice(),
) => {
  const asked: (DbusCall | DbusMatch)[] = [];
  const stops = { count: 0 };
  const { promise: listening, resolve: listen } =
    Promise.withResolvers<ReadableStreamDefaultController<DbusSignal>>();
  return {
    asked,
    dbusCall: (call: DbusCall) => {
      asked.push(call);
      return Promise.resolve(
        "kind" in reply
          ? Err<{ body: unknown[]; signature: string }, SystemError>(reply)
          : Ok<{ body: unknown[]; signature: string }, SystemError>(reply),
      );
    },
    dbusMatch: (match: DbusMatch) => {
      asked.push(match);
      const items = new ReadableStream<DbusSignal>({ start: listen });
      return Promise.resolve(
        Ok<Listening<DbusSignal>, SystemError>({
          ended: Promise.resolve(Ok("stopped")),
          items,
          stop: () => {
            stops.count += 1;
          },
        }),
      );
    },
    signal: async (signal: DbusSignal) => {
      (await listening).enqueue(signal);
    },
    stops,
  };
};

/** The watch, or a failure that names the error. */
const started = <T extends NonNullable<unknown>>(
  result: Result<T, SystemError>,
): T =>
  result.match({
    Err: (error) => {
      throw new Error(`the watch failed: ${error.message}`);
    },
    Ok: (value) => value,
  });

describe("readBattery", () => {
  it("reads the DisplayDevice's charge and charger from UPower", async () => {
    const bus = upower();

    expect(await readBattery(bus)).toStrictEqual(
      Ok(Some({ charge: 0.873, charging: false })),
    );
    expect(bus.asked).toStrictEqual([
      {
        body: ["org.freedesktop.UPower.Device"],
        bus: Bus.System,
        destination: "org.freedesktop.UPower",
        interface: "org.freedesktop.DBus.Properties",
        member: "GetAll",
        path: DEVICE,
        signature: "s",
      },
    ]);
  });

  it("reads no battery on a machine without one", async () => {
    const bus = upower(
      displayDevice({
        IsPresent: { signature: "b", value: false },
        Percentage: { signature: "d", value: 0 },
        State: { signature: "u", value: 0 },
        Type: { signature: "u", value: 0 },
      }),
    );

    expect(await readBattery(bus)).toStrictEqual(Ok(None()));
  });

  it("counts a charger as connected unless the battery is draining", async () => {
    // UPower's states: 0 unknown, 1 charging, 2 discharging, 3 empty, 4 fully
    // charged, 5 pending charge, 6 pending discharge.
    const charging = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map(async (state) =>
        (
          await readBattery(
            upower(displayDevice({ State: { signature: "u", value: state } })),
          )
        ).map((battery) => battery.map(({ charging }) => charging)),
      ),
    );

    expect(charging).toStrictEqual(
      [true, true, false, false, true, true, false].map((on) => Ok(Some(on))),
    );
  });

  it("fails as the bus failed", async () => {
    expect(await readBattery(upower(LOCKED))).toStrictEqual(Err(LOCKED));
  });
});

describe("watchBattery", () => {
  it("listens for changes before it reads, so it misses none", async () => {
    const bus = upower();

    await watchBattery(bus);

    expect(bus.asked[0]).toStrictEqual({
      bus: Bus.System,
      interface: "org.freedesktop.DBus.Properties",
      member: "PropertiesChanged",
      path: DEVICE,
      sender: "org.freedesktop.UPower",
    });
    expect(bus.asked[1]).toMatchObject({ member: "GetAll" });
  });

  it("gives the current reading and then each change", async () => {
    const bus = upower();
    const watching = started(await watchBattery(bus));
    const readings = watching.items.getReader();

    await bus.signal(changed({ Percentage: { signature: "d", value: 86 } }));
    await bus.signal(changed({ State: { signature: "u", value: 1 } }));

    const read = async (): Promise<Option<Battery> | undefined> =>
      (await readings.read()).value;
    expect(await read()).toStrictEqual(
      Some({ charge: 0.873, charging: false }),
    );
    expect(await read()).toStrictEqual(Some({ charge: 0.86, charging: false }));
    expect(await read()).toStrictEqual(Some({ charge: 0.86, charging: true }));
  });

  it("ignores changes to the device's other interfaces", async () => {
    const bus = upower();
    const watching = started(await watchBattery(bus));
    const readings = watching.items.getReader();

    await bus.signal(
      changed({ State: { signature: "u", value: 1 } }, "org.example.Other"),
    );
    await bus.signal(changed({ Percentage: { signature: "d", value: 50 } }));

    await readings.read();
    expect((await readings.read()).value).toStrictEqual(
      Some({ charge: 0.5, charging: false }),
    );
  });

  it("stops listening when stopped", async () => {
    const bus = upower();

    started(await watchBattery(bus)).stop();

    expect(bus.stops.count).toBe(1);
  });

  it("stops listening and fails when the first read fails", async () => {
    const bus = upower(LOCKED);

    expect(await watchBattery(bus)).toStrictEqual(Err(LOCKED));
    expect(bus.stops.count).toBe(1);
  });
});
