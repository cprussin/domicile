// BlueZ over the system bus: adapters and devices, kept current, and the
// requests that change them. See docs/SHELL-SYSTEM-ACCESS.md.

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
const BATTERY = "org.bluez.Battery1";

/** The properties whose changes alter a {@link Bluetooth}, by interface. */
const WATCHED: Readonly<Record<string, readonly string[]>> = {
  [ADAPTER]: ["Discovering", "Powered"],
  [BATTERY]: ["Percentage"],
  [DEVICE]: ["Alias", "Connected", "Name", "Paired"],
};

/** A controller, such as `/org/bluez/hci0`. */
export type Adapter = { path: string; powered: boolean; discovering: boolean };

/**
 * A device BlueZ knows. `name` is its alias, which BlueZ fills from its name.
 * `battery` is 0 through 100, for a device that reports it.
 */
export type Device = {
  path: string;
  adapter: string;
  address: string;
  name: string;
  paired: boolean;
  connected: boolean;
  battery: number | undefined;
};

/**
 * Every adapter, and each device that is paired or, found by a scan, has a
 * name. A scan finds many nameless devices, such as beacons.
 */
export type Bluetooth = { adapters: Adapter[]; devices: Device[] };

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

/** Start scanning for devices. BlueZ stops when every scanner has asked. */
export const startDiscovery = (
  system: Pick<System, "dbusCall">,
  adapter: string,
): Promise<Result<"done", SystemError>> =>
  call(system, adapter, ADAPTER, "StartDiscovery");

export const stopDiscovery = (
  system: Pick<System, "dbusCall">,
  adapter: string,
): Promise<Result<"done", SystemError>> =>
  call(system, adapter, ADAPTER, "StopDiscovery");

/** Connect a paired device's profiles. */
export const connect = (
  system: Pick<System, "dbusCall">,
  device: string,
): Promise<Result<"done", SystemError>> =>
  call(system, device, DEVICE, "Connect");

export const disconnect = (
  system: Pick<System, "dbusCall">,
  device: string,
): Promise<Result<"done", SystemError>> =>
  call(system, device, DEVICE, "Disconnect");

/**
 * Pair with a device, then trust it so it can reconnect on its own. With no
 * agent registered, BlueZ pairs only devices that need no code.
 */
export const pair = async (
  system: Pick<System, "dbusCall">,
  device: string,
): Promise<Result<"done", SystemError>> =>
  (await call(system, device, DEVICE, "Pair")).andThenAsync(async () =>
    (
      await system.dbusCall({
        body: [DEVICE, "Trusted", { signature: "b", value: true }],
        bus: Bus.System,
        destination: SERVICE,
        interface: "org.freedesktop.DBus.Properties",
        member: "Set",
        path: device,
        signature: "ssv",
      })
    ).map(() => "done" as const),
  );

/** Remove a device and its pairing. */
export const forget = async (
  system: Pick<System, "dbusCall">,
  device: Pick<Device, "adapter" | "path">,
): Promise<Result<"done", SystemError>> =>
  (
    await system.dbusCall({
      body: [device.path],
      bus: Bus.System,
      destination: SERVICE,
      interface: ADAPTER,
      member: "RemoveDevice",
      path: device.adapter,
      signature: "o",
    })
  ).map(() => "done");

/** A BlueZ method that takes no arguments. */
const call = async (
  system: Pick<System, "dbusCall">,
  path: string,
  iface: string,
  member: string,
): Promise<Result<"done", SystemError>> =>
  (
    await system.dbusCall({
      bus: Bus.System,
      destination: SERVICE,
      interface: iface,
      member,
      path,
    })
  ).map(() => "done");

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
        : [
            {
              discovering: held[ADAPTER].Discovering,
              path,
              powered: held[ADAPTER].Powered,
            },
          ],
    ),
    devices: entries.flatMap(([path, held]) => {
      const device = held[DEVICE];
      return device === undefined ||
        (!device.Paired && device.Name === undefined)
        ? []
        : [
            {
              adapter: device.Adapter,
              address: device.Address,
              battery: held[BATTERY]?.Percentage,
              connected: device.Connected,
              name: device.Alias,
              paired: device.Paired,
              path,
            },
          ];
    }),
  };
};

/** A `v`, as `domicile_host::dbus_json` writes it, read as its value. */
const variant = <T>(value: z.ZodType<T>) =>
  z.object({ value }).transform(({ value: held }) => held);

const managedObjectsSchema = z.tuple([
  z.record(
    z.string(),
    z.object({
      [ADAPTER]: z
        .object({
          Discovering: variant(z.boolean()),
          Powered: variant(z.boolean()),
        })
        .optional(),
      [BATTERY]: z.object({ Percentage: variant(z.number()) }).optional(),
      [DEVICE]: z
        .object({
          Adapter: variant(z.string()),
          Address: variant(z.string()),
          Alias: variant(z.string()),
          Connected: variant(z.boolean()),
          Name: variant(z.string()).optional(),
          Paired: variant(z.boolean()),
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
