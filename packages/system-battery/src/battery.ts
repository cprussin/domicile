// The battery, from UPower's DisplayDevice over the system bus: the combined
// charge of every battery and whether a charger is connected.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type {
  DbusSignal,
  Listening,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

const UPOWER = "org.freedesktop.UPower";
const DEVICE = "org.freedesktop.UPower.Device";
const DISPLAY_DEVICE = "/org/freedesktop/UPower/devices/DisplayDevice";
const PROPERTIES = "org.freedesktop.DBus.Properties";

/** UPower's `State`s in which the battery drains: discharging, empty, pending discharge. */
const DRAINING: readonly number[] = [2, 3, 6];

export type Battery = {
  /** 0 through 1. */
  charge: number;
  /** Whether a charger is connected: true while charging, full or held. */
  charging: boolean;
};

/**
 * The battery now, or `None` on a machine without one.
 *
 * Fails while the desktop is locked, like every D-Bus call.
 */
export const readBattery = async (
  bus: Pick<System, "dbusCall">,
): Promise<Result<Option<Battery>, SystemError>> =>
  (await readProperties(bus)).map(batteryOf);

/**
 * The battery now as the first item, then after each change.
 *
 * Listens before it reads, so no change is missed. Changes keep arriving while
 * the desktop is locked; starting fails then.
 */
export const watchBattery = async (
  bus: Pick<System, "dbusCall" | "dbusMatch">,
): Promise<Result<Listening<Option<Battery>>, SystemError>> =>
  (
    await bus.dbusMatch({
      bus: Bus.System,
      interface: PROPERTIES,
      member: "PropertiesChanged",
      path: DISPLAY_DEVICE,
      sender: UPOWER,
    })
  ).andThenAsync(async (changes) =>
    (await readProperties(bus)).match({
      Err: (error) => {
        changes.stop();
        return Err(error);
      },
      Ok: (properties) =>
        Ok({
          ended: changes.ended,
          items: changes.items.pipeThrough(readings(properties)),
          stop: changes.stop,
        }),
    }),
  );

const variantSchema = z.object({ signature: z.string(), value: z.unknown() });

const propertiesSchema = z.record(z.string(), variantSchema);

type Properties = z.infer<typeof propertiesSchema>;

const getAllSchema = z.tuple([propertiesSchema]);

const propertiesChangedSchema = z.tuple([
  z.string(),
  propertiesSchema,
  z.array(z.string()),
]);

const deviceSchema = z.looseObject({
  IsPresent: z.object({ value: z.boolean() }),
  Percentage: z.object({ value: z.number() }),
  State: z.object({ value: z.number().int() }),
});

const readProperties = async (
  bus: Pick<System, "dbusCall">,
): Promise<Result<Properties, SystemError>> =>
  (
    await bus.dbusCall({
      body: [DEVICE],
      bus: Bus.System,
      destination: UPOWER,
      interface: PROPERTIES,
      member: "GetAll",
      path: DISPLAY_DEVICE,
      signature: "s",
    })
  ).map(({ body }) => getAllSchema.parse(body)[0]);

/**
 * Each reading, starting from `properties` and folding in each change to the
 * device's own interface.
 */
const readings = (properties: Properties) => {
  let current = properties;
  return new TransformStream<DbusSignal, Option<Battery>>({
    start: (controller) => {
      controller.enqueue(batteryOf(current));
    },
    transform: (signal, controller) => {
      const [iface, changed] = propertiesChangedSchema.parse(signal.body);
      if (iface === DEVICE) {
        current = { ...current, ...changed };
        controller.enqueue(batteryOf(current));
      }
    },
  });
};

const batteryOf = (properties: Properties): Option<Battery> => {
  const { IsPresent, Percentage, State } = deviceSchema.parse(properties);
  return IsPresent.value
    ? Some({
        charge: Percentage.value / 100,
        charging: !DRAINING.includes(State.value),
      })
    : None();
};
