import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok } from "@cprussin/option-result";
import type {
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus, Listened, SystemErrorKind } from "@domicile-desktop/sdk/system";

import { watchAmbientLight } from "./watch-ambient-light";

const PROXY = "net.hadess.SensorProxy";
const PATH = "/net/hadess/SensorProxy";

/** iio-sensor-proxy's `GetAll` reply, as recorded on a Framework laptop. */
const sensors = (hasLight: boolean, lux: number) => ({
  body: [
    {
      AccelerometerOrientation: { signature: "s", value: "undefined" },
      HasAccelerometer: { signature: "b", value: false },
      HasAmbientLight: { signature: "b", value: hasLight },
      HasProximity: { signature: "b", value: false },
      LightLevel: { signature: "d", value: lux },
      LightLevelUnit: { signature: "s", value: "lux" },
    },
  ],
  signature: "a{sv}",
});

const changed = (lux: number, iface = PROXY): DbusSignal => ({
  body: [iface, { LightLevel: { signature: "d", value: lux } }, []],
  interface: "org.freedesktop.DBus.Properties",
  member: "PropertiesChanged",
  path: PATH,
  sender: ":1.40",
  signature: "sa{sv}as",
});

type Reply = { body: unknown[]; signature: string } | SystemError;

const CLAIMED: Reply = { body: [], signature: "" };

/**
 * The system bus as iio-sensor-proxy answers it: each call takes the next of
 * `replies`, and a match hands over what `signal` and `miss` send.
 */
const proxy = (...replies: Reply[]) => {
  const asked: (DbusCall | DbusMatch)[] = [];
  const stops = { count: 0 };
  const { promise: listening, resolve: listen } =
    Promise.withResolvers<
      ReadableStreamDefaultController<Listened<DbusSignal>>
    >();
  return {
    asked,
    dbus: {
      call: (call: DbusCall) => {
        asked.push(call);
        const reply = replies.shift();
        if (reply === undefined) {
          throw new Error(`nothing left to answer ${call.member} with`);
        } else {
          return Promise.resolve(
            "kind" in reply
              ? Err<{ body: unknown[]; signature: string }, SystemError>(reply)
              : Ok<{ body: unknown[]; signature: string }, SystemError>(reply),
          );
        }
      },
      match: (match: DbusMatch) => {
        asked.push(match);
        const items = new ReadableStream<Listened<DbusSignal>>({
          start: listen,
        });
        return Promise.resolve(
          Ok<Listening<Listened<DbusSignal>>, SystemError>({
            ended: Promise.resolve(Ok("stopped")),
            items,
            stop: () => {
              stops.count += 1;
            },
          }),
        );
      },
    },
    miss: async () => {
      (await listening).enqueue(Listened.Missed());
    },
    replies,
    signal: async (signal: DbusSignal) => {
      (await listening).enqueue(Listened.Heard(signal));
    },
    stops,
  };
};

const watching = (
  result: Result<Option<Listening<number>>, SystemError>,
): Listening<number> =>
  result.match({
    Err: (error) => {
      throw new Error(`the watch failed: ${error.message}`);
    },
    Ok: (found) =>
      found.match({
        None: () => {
          throw new Error("no sensor was found");
        },
        Some: (watch) => watch,
      }),
  });

const GET_ALL = {
  body: [PROXY],
  bus: Bus.System,
  destination: PROXY,
  interface: "org.freedesktop.DBus.Properties",
  member: "GetAll",
  path: PATH,
  signature: "s",
};

const call = (member: string) => ({
  bus: Bus.System,
  destination: PROXY,
  interface: PROXY,
  member,
  path: PATH,
});

describe("watchAmbientLight", () => {
  it("claims the sensor and reads its level after the claim", async () => {
    const bus = proxy(sensors(true, 0), CLAIMED, sensors(true, 312.5));

    const reader = watching(await watchAmbientLight(bus)).items.getReader();

    expect((await reader.read()).value).toBe(312.5);
    expect(bus.asked).toStrictEqual([
      {
        bus: Bus.System,
        interface: "org.freedesktop.DBus.Properties",
        member: "PropertiesChanged",
        path: PATH,
        sender: PROXY,
      },
      GET_ALL,
      call("ClaimLight"),
      GET_ALL,
    ]);
  });

  it("reports each change of the level", async () => {
    const bus = proxy(sensors(true, 0), CLAIMED, sensors(true, 40));
    const reader = watching(await watchAmbientLight(bus)).items.getReader();
    await reader.read();

    await bus.signal(changed(9000));

    expect((await reader.read()).value).toBe(9000);
  });

  it("ignores changes to another interface", async () => {
    const bus = proxy(sensors(true, 0), CLAIMED, sensors(true, 40));
    const reader = watching(await watchAmbientLight(bus)).items.getReader();
    await reader.read();

    await bus.signal(changed(1, "net.hadess.SensorProxy.Compass"));
    await bus.signal(changed(80));

    expect((await reader.read()).value).toBe(80);
  });

  it("claims the sensor again for a new compositor", async () => {
    const bus = proxy(sensors(true, 0), CLAIMED, sensors(true, 40));
    const reader = watching(await watchAmbientLight(bus)).items.getReader();
    await reader.read();
    bus.replies.push(CLAIMED, sensors(true, 55));

    await bus.miss();

    expect((await reader.read()).value).toBe(55);
    expect(bus.asked.slice(-2)).toStrictEqual([call("ClaimLight"), GET_ALL]);
  });

  it("releases the sensor when it stops", async () => {
    const bus = proxy(sensors(true, 0), CLAIMED, sensors(true, 40), CLAIMED);
    const watch = watching(await watchAmbientLight(bus));

    watch.stop();

    expect(bus.stops.count).toBe(1);
    expect(bus.asked.at(-1)).toStrictEqual(call("ReleaseLight"));
  });

  it("finds no sensor on a machine without one", async () => {
    const bus = proxy(sensors(false, 0));

    expect(await watchAmbientLight(bus)).toStrictEqual(Ok(None()));
    expect(bus.stops.count).toBe(1);
  });

  it("finds no sensor without iio-sensor-proxy", async () => {
    const bus = proxy({
      kind: SystemErrorKind.Dbus,
      message:
        "org.freedesktop.DBus.Error.ServiceUnknown: The name net.hadess.SensorProxy was not provided by any .service files",
    });

    expect(await watchAmbientLight(bus)).toStrictEqual(Ok(None()));
    expect(bus.stops.count).toBe(1);
  });

  it("passes on any other failure", async () => {
    const locked: SystemError = {
      kind: SystemErrorKind.Locked,
      message: "the desktop is locked",
    };
    const bus = proxy(locked);

    expect(await watchAmbientLight(bus)).toStrictEqual(Err(locked));
  });
});
