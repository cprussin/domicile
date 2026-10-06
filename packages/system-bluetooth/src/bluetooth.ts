// BlueZ over the system bus: adapters and connected devices, kept current.
// See docs/architecture/SYSTEM-ACCESS.md.

import type { Result } from "@cprussin/option-result";
import { Err } from "@cprussin/option-result";
import type {
  DbusSignal,
  Listening,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

const SERVICE = "org.bluez";
const ADAPTER = "org.bluez.Adapter1";
const DEVICE = "org.bluez.Device1";

/** The properties whose changes alter a {@link Bluetooth}, by interface. */
const WATCHED: Readonly<Record<string, readonly string[]>> = {
  [ADAPTER]: ["Powered"],
  [DEVICE]: ["Alias", "Connected"],
};

/** A controller, such as `/org/bluez/hci0`. */
export type Adapter = { path: string; powered: boolean };

/** A connected device. `name` is its alias, which BlueZ fills from its name. */
export type Device = { path: string; name: string };

export type Bluetooth = { adapters: Adapter[]; connected: Device[] };

/** The calls this library makes. */
export type BluetoothSystem = Pick<System, "dbusCall" | "dbusMatch">;

/**
 * Calls `onBluetooth` with the adapters and connected devices now and after
 * each change, and returns a function that stops watching.
 *
 * An `Err` is a D-Bus failure, such as BlueZ not running. The watch keeps
 * listening after one, so a later change reads again.
 */
export const watchBluetooth = (
  system: BluetoothSystem,
  onBluetooth: (bluetooth: Result<Bluetooth, SystemError>) => void,
): (() => void) => {
  const watch: Watch = { listening: undefined, stopped: false };
  const report = (bluetooth: Result<Bluetooth, SystemError>) => {
    if (!watch.stopped) {
      onBluetooth(bluetooth);
    }
  };
  follow(system, watch, report).catch((error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: surfacing a background failure
    console.error("Failed to watch Bluetooth", error);
  });
  return () => {
    watch.stopped = true;
    watch.listening?.stop();
  };
};

/** Turn the adapter at `adapter` on or off. */
export const setPowered = async (
  system: Pick<System, "dbusCall">,
  adapter: string,
  powered: boolean,
): Promise<Result<"set", SystemError>> =>
  (
    await system.dbusCall({
      body: [ADAPTER, "Powered", { signature: "b", value: powered }],
      bus: Bus.System,
      destination: SERVICE,
      interface: "org.freedesktop.DBus.Properties",
      member: "Set",
      path: adapter,
      signature: "ssv",
    })
  ).map(() => "set");

/** A watch's state, shared by its loop and its stop function. */
type Watch = {
  listening: Listening<DbusSignal> | undefined;
  stopped: boolean;
};

/** Listen, read, then read again on each change until the match ends. */
const follow = async (
  system: BluetoothSystem,
  watch: Watch,
  report: (bluetooth: Result<Bluetooth, SystemError>) => void,
): Promise<void> => {
  const matched = await system.dbusMatch({ bus: Bus.System, sender: SERVICE });
  await matched.match({
    Err: (error) => {
      report(Err(error));
      return Promise.resolve();
    },
    Ok: async (listening) => {
      watch.listening = listening;
      if (watch.stopped) {
        listening.stop();
      }
      await changes(system, listening, report);
      const ended = await listening.ended;
      ended.match({
        Err: (error) => {
          report(Err(error));
        },
        Ok: () => {
          /* stopped by the caller */
        },
      });
    },
  });
};

/** Read now, and again on each signal that changes what was read. */
const changes = async (
  system: BluetoothSystem,
  listening: Listening<DbusSignal>,
  report: (bluetooth: Result<Bluetooth, SystemError>) => void,
): Promise<void> => {
  const reader = listening.items.getReader();
  report(await read(system));
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (matters(next.value)) {
      report(await read(system));
    }
  }
};

/**
 * Whether `signal` can change a {@link Bluetooth}: an object coming or going,
 * or a watched property. Signal strength and the like change often during a
 * scan and are skipped.
 */
const matters = (signal: DbusSignal): boolean => {
  switch (signal.member) {
    case "InterfacesAdded":
    case "InterfacesRemoved": {
      return true;
    }
    case "PropertiesChanged": {
      const [iface, changed] = propertiesChangedSchema.parse(signal.body);
      return (WATCHED[iface] ?? []).some((name) => name in changed);
    }
    default: {
      return false;
    }
  }
};

const read = async (
  system: BluetoothSystem,
): Promise<Result<Bluetooth, SystemError>> =>
  (
    await system.dbusCall({
      bus: Bus.System,
      destination: SERVICE,
      interface: "org.freedesktop.DBus.ObjectManager",
      member: "GetManagedObjects",
      path: "/",
    })
  ).map(({ body }) => bluetoothOf(managedObjectsSchema.parse(body)[0]));

const bluetoothOf = (objects: ManagedObjects): Bluetooth => {
  const entries = Object.entries(objects);
  return {
    adapters: entries.flatMap(([path, held]) =>
      held[ADAPTER] === undefined
        ? []
        : [{ path, powered: held[ADAPTER].Powered }],
    ),
    connected: entries.flatMap(([path, held]) =>
      held[DEVICE]?.Connected === true
        ? [{ name: held[DEVICE].Alias, path }]
        : [],
    ),
  };
};

/** A `v`, as `domicile_host::dbus_json` writes it, read as its value. */
const variant = <T>(value: z.ZodType<T>) =>
  z.object({ value }).transform(({ value: held }) => held);

const managedObjectsSchema = z.tuple([
  z.record(
    z.string(),
    z.object({
      [ADAPTER]: z.object({ Powered: variant(z.boolean()) }).optional(),
      [DEVICE]: z
        .object({
          Alias: variant(z.string()),
          Connected: variant(z.boolean()),
        })
        .optional(),
    }),
  ),
]);

type ManagedObjects = z.infer<typeof managedObjectsSchema>[0];

const propertiesChangedSchema = z.tuple([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.string()),
]);
