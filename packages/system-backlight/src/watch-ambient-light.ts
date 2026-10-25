// The ambient light sensor, from iio-sensor-proxy over the system bus, for
// automatic brightness. See https://gitlab.freedesktop.org/hadess/iio-sensor-proxy.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type {
  DbusSignal,
  Listened,
  Listening,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import {
  Bus,
  ListenedKind,
  SystemErrorKind,
} from "@domicile-desktop/sdk/system";
import { z } from "zod";

const PROXY = "net.hadess.SensorProxy";
const PATH = "/net/hadess/SensorProxy";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const NO_SERVICE = "org.freedesktop.DBus.Error.ServiceUnknown";

type SensorBus = Pick<System, "dbusCall" | "dbusMatch">;

/**
 * The light level as the first item, then after each change, or `None` on a
 * machine without a sensor or without iio-sensor-proxy.
 *
 * The level is in lux, or in the sensor's own units on a sensor that reports
 * no lux. Claims the sensor, which keeps it reading, until `stop`. Claims it
 * again after a compositor restart, whose bus connection held the claim.
 */
export const watchAmbientLight = async (
  bus: SensorBus,
): Promise<Result<Option<Listening<number>>, SystemError>> =>
  (
    await bus.dbusMatch({
      bus: Bus.System,
      interface: PROPERTIES,
      member: "PropertiesChanged",
      path: PATH,
      sender: PROXY,
    })
  ).andThenAsync(async (changes) =>
    (await readSensors(bus)).match({
      Err: (error) => Promise.resolve(stopped(changes, error)),
      Ok: async (read) => {
        if (read.HasAmbientLight.value) {
          return (await claimedLevel(bus)).match({
            Err: (error) => {
              changes.stop();
              return Err(error);
            },
            Ok: (level) =>
              Ok(
                Some({
                  ended: changes.ended,
                  items: changes.items.pipeThrough(levels(bus, level)),
                  stop: () => {
                    changes.stop();
                    release(bus);
                  },
                }),
              ),
          });
        } else {
          changes.stop();
          return Ok(None());
        }
      },
    }),
  );

/** `changes` stopped: no sensor when iio-sensor-proxy is not there. */
const stopped = (
  changes: Listening<unknown>,
  error: SystemError,
): Result<Option<Listening<number>>, SystemError> => {
  changes.stop();
  return error.kind === SystemErrorKind.Dbus &&
    error.message.startsWith(NO_SERVICE)
    ? Ok(None())
    : Err(error);
};

const variantSchema = z.object({ signature: z.string(), value: z.unknown() });

const sensorsSchema = z.tuple([
  z.looseObject({
    HasAmbientLight: z.object({ value: z.boolean() }),
    LightLevel: z.object({ value: z.number() }),
  }),
]);

const propertiesChangedSchema = z.tuple([
  z.string(),
  z.record(z.string(), variantSchema),
  z.array(z.string()),
]);

const changedLevelSchema = z.object({ value: z.number() }).optional();

const call = (bus: SensorBus, member: string) =>
  bus.dbusCall({
    bus: Bus.System,
    destination: PROXY,
    interface: PROXY,
    member,
    path: PATH,
  });

const readSensors = async (bus: SensorBus) =>
  (
    await bus.dbusCall({
      body: [PROXY],
      bus: Bus.System,
      destination: PROXY,
      interface: PROPERTIES,
      member: "GetAll",
      path: PATH,
      signature: "s",
    })
  ).map(({ body }) => sensorsSchema.parse(body)[0]);

/** Claims the sensor, then reads the level it measured since. */
const claimedLevel = async (
  bus: SensorBus,
): Promise<Result<number, SystemError>> =>
  (await call(bus, "ClaimLight")).andThenAsync(async () =>
    (await readSensors(bus)).map((read) => read.LightLevel.value),
  );

const release = (bus: SensorBus): void => {
  call(bus, "ReleaseLight")
    .then((result) => {
      result.match({
        Err: logRelease,
        Ok: () => undefined,
      });
    })
    .catch(logRelease);
};

const logRelease = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: a background release has no caller to tell
  console.error("could not release the ambient light sensor", error);
};

/**
 * Each level, starting from `level`. After a compositor restart the sensor is
 * claimed and read again; a claim the next restart ends waits for the restart
 * after it.
 */
const levels = (bus: SensorBus, level: number) =>
  new TransformStream<Listened<DbusSignal>, number>({
    start: (controller) => {
      controller.enqueue(level);
    },
    transform: async (heard, controller) => {
      switch (heard.kind) {
        case ListenedKind.Heard: {
          const [iface, changed] = propertiesChangedSchema.parse(
            heard.item.body,
          );
          const changedLevel = changedLevelSchema.parse(changed.LightLevel);
          if (iface === PROXY && changedLevel !== undefined) {
            controller.enqueue(changedLevel.value);
          }
          break;
        }
        case ListenedKind.Missed: {
          (await claimedLevel(bus)).match({
            Err: (error) => {
              if (error.kind !== SystemErrorKind.CompositorGone) {
                controller.error(error);
              }
            },
            Ok: (claimed) => {
              controller.enqueue(claimed);
            },
          });
          break;
        }
      }
    },
  });
