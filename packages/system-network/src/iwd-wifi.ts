// iwd's Wi-Fi device over the system bus: its networks and connection, kept
// current, and the requests that change them. See docs/SHELL-SYSTEM-ACCESS.md.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type {
  DbusCall,
  DbusSignal,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus, SystemErrorKind } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import { followBus } from "./follow";
import type { NetworkSystem } from "./network-state";
import { strengthOfDbm } from "./signal-strength";
import { variant } from "./variant";
import type {
  Wifi,
  WifiConnection,
  WifiDevice,
  WifiNetwork,
  WifiSystem,
} from "./wifi-state";
import { WifiBackend } from "./wifi-state";

const SERVICE = "net.connman.iwd";
const DEVICE = `${SERVICE}.Device`;
const STATION = `${SERVICE}.Station`;
const NETWORK = `${SERVICE}.Network`;
const DIAGNOSTIC = `${SERVICE}.StationDiagnostic`;

/** The interfaces whose property changes alter a {@link Wifi}. */
const WATCHED = [DEVICE, STATION, NETWORK];

type Found = z.infer<typeof managedObjectsSchema>[0];

/**
 * Calls `onWifi` with the first station device now and after each change, and
 * returns a function that stops watching. `None` is a machine without one.
 *
 * An `Err` is a D-Bus failure, such as iwd not running. The watch keeps
 * listening after one, so a later change reads again.
 */
export const watchIwdWifi = (
  system: NetworkSystem,
  onWifi: (wifi: Result<Option<Wifi>, SystemError>) => void,
): (() => void) =>
  followBus(
    system,
    { bus: Bus.System, sender: SERVICE },
    async () => ({ matters, value: await read(system) }),
    onWifi,
  );

/** Turn the device on or off. */
export const setIwdWifiEnabled = async (
  system: NetworkSystem,
  wifi: WifiDevice,
  enabled: boolean,
): Promise<Result<"done", SystemError>> =>
  done(
    await system.dbusCall({
      ...request(wifi.device, "org.freedesktop.DBus.Properties", "Set"),
      body: [DEVICE, "Powered", { signature: "b", value: enabled }],
      signature: "ssv",
    }),
  );

/** Ask for a scan. Networks it finds arrive as changes. */
export const scanIwdWifi = async (
  system: NetworkSystem,
  wifi: WifiDevice,
): Promise<Result<"done", SystemError>> =>
  done(await system.dbusCall(request(wifi.device, STATION, "Scan")));

/**
 * Join `network`. A known or open network joins over D-Bus. A new secured one
 * joins through `iwctl`, which answers iwd's request for the passphrase: iwd
 * asks an agent for it, and a page cannot serve one.
 */
export const connectIwdWifi = async (
  system: WifiSystem,
  wifi: WifiDevice,
  network: WifiNetwork,
  passphrase: string | undefined,
): Promise<Result<"done", SystemError>> => {
  if (network.profile !== undefined || !network.secured) {
    return done(
      await system.dbusCall(request(network.path, NETWORK, "Connect")),
    );
  } else if (passphrase === undefined) {
    throw new Error(`joining ${network.ssid} needs a passphrase`);
  } else {
    const ran = await system.run([
      "iwctl",
      "--passphrase",
      passphrase,
      "station",
      wifi.interface,
      "connect",
      network.ssid,
    ]);
    return ran.andThen(({ code, stderr, stdout }) =>
      code === 0
        ? Ok("done")
        : Err({
            kind: SystemErrorKind.Other,
            message: `${stdout}${stderr}`.trim(),
          }),
    );
  }
};

/** Leave the current network, until asked to join one. */
export const disconnectIwdWifi = async (
  system: NetworkSystem,
  wifi: WifiDevice,
): Promise<Result<"done", SystemError>> =>
  done(await system.dbusCall(request(wifi.device, STATION, "Disconnect")));

const request = (path: string, iface: string, member: string): DbusCall => ({
  bus: Bus.System,
  destination: SERVICE,
  interface: iface,
  member,
  path,
});

const done = <T extends NonNullable<unknown>>(
  reply: Result<T, SystemError>,
): Result<"done", SystemError> => reply.map(() => "done");

/** Whether `signal` can change Wi-Fi: an object coming or going, or a property. */
const matters = (signal: DbusSignal): boolean => {
  switch (signal.member) {
    case "InterfacesAdded":
    case "InterfacesRemoved": {
      return true;
    }
    case "PropertiesChanged": {
      const [iface] = propertiesChangedSchema.parse(signal.body);
      return WATCHED.includes(iface);
    }
    default: {
      return false;
    }
  }
};

const read = async (
  system: NetworkSystem,
): Promise<Result<Option<Wifi>, SystemError>> =>
  (
    await system.dbusCall({
      bus: Bus.System,
      destination: SERVICE,
      interface: "org.freedesktop.DBus.ObjectManager",
      member: "GetManagedObjects",
      path: "/",
    })
  ).andThenAsync(async ({ body }) => {
    const objects = managedObjectsSchema.parse(body)[0];
    const station = Object.entries(objects).flatMap(([path, held]) => {
      const device = held[DEVICE];
      return device?.Mode === "station" ? [{ device, held, path }] : [];
    })[0];
    return station === undefined
      ? Ok(None())
      : (
          await wifiOf(
            system,
            objects,
            station.path,
            station.device,
            station.held,
          )
        ).map((wifi) => Some(wifi));
  });

const wifiOf = async (
  system: NetworkSystem,
  objects: Found,
  path: string,
  device: NonNullable<Found[string][typeof DEVICE]>,
  held: Found[string],
): Promise<Result<Wifi, SystemError>> => {
  const off = {
    backend: WifiBackend.Iwd,
    connection: undefined,
    device: path,
    enabled: device.Powered,
    hardwareAddress: device.Address,
    interface: device.Name,
    networks: [],
    scanning: false,
  };
  const station = held[STATION];
  return station === undefined
    ? Ok(off)
    : (await stationOf(system, objects, path, station, held[DIAGNOSTIC])).map(
        (found) => ({ ...off, ...found }),
      );
};

/** What a station adds to its device. */
type StationFound = Pick<Wifi, "connection" | "networks" | "scanning">;

const stationOf = async (
  system: NetworkSystem,
  objects: Found,
  path: string,
  station: Station,
  diagnostic: object | undefined,
): Promise<Result<StationFound, SystemError>> =>
  (
    await system.dbusCall(request(path, STATION, "GetOrderedNetworks"))
  ).andThenAsync(async ({ body }) => {
    const networks = orderedNetworksSchema
      .parse(body)[0]
      .map(([network, signal]) => networkOf(objects, network, signal));
    const connected = networks.find(({ connected: on }) => on);
    const connection =
      connected === undefined
        ? Ok<Option<WifiConnection>, SystemError>(None())
        : (await diagnosticsOf(system, path, diagnostic)).map((found) =>
            Some({
              ...found,
              ip: undefined,
              ssid: connected.ssid,
              strength: connected.strength,
            }),
          );
    return connection.map((current) => ({
      connection: current.match({
        None: () => undefined,
        Some: (found) => found,
      }),
      networks,
      scanning: station.Scanning,
    }));
  });

const networkOf = (
  objects: Found,
  path: string,
  signal: number,
): WifiNetwork => {
  const network = objects[path]?.[NETWORK];
  if (network === undefined) {
    throw new Error(`iwd ordered a network it does not have: ${path}`);
  } else {
    return {
      connected: network.Connected,
      path,
      profile: network.KnownNetwork,
      secured: network.Type !== "open",
      ssid: network.Name,
      strength: strengthOfDbm(signal / 100),
    };
  }
};

type Diagnostics = Pick<WifiConnection, "bitrate" | "frequency">;

/** The link's frequency and bitrate, when iwd offers diagnostics. */
const diagnosticsOf = async (
  system: NetworkSystem,
  path: string,
  diagnostic: object | undefined,
): Promise<Result<Diagnostics, SystemError>> =>
  diagnostic === undefined
    ? Ok({ bitrate: undefined, frequency: undefined })
    : (await system.dbusCall(request(path, DIAGNOSTIC, "GetDiagnostics"))).map(
        ({ body }) => {
          const [found] = diagnosticsSchema.parse(body);
          return { bitrate: found.RxBitrate / 10, frequency: found.Frequency };
        },
      );

const stationSchema = z.object({ Scanning: variant(z.boolean()) });

type Station = z.infer<typeof stationSchema>;

const managedObjectsSchema = z.tuple([
  z.record(
    z.string(),
    z.object({
      [DEVICE]: z
        .object({
          Address: variant(z.string()),
          Mode: variant(z.string()),
          Name: variant(z.string()),
          Powered: variant(z.boolean()),
        })
        .optional(),
      [DIAGNOSTIC]: z.object({}).optional(),
      [NETWORK]: z
        .object({
          Connected: variant(z.boolean()),
          KnownNetwork: variant(z.string()).optional(),
          Name: variant(z.string()),
          Type: variant(z.string()),
        })
        .optional(),
      [STATION]: stationSchema.optional(),
    }),
  ),
]);

/** Each network's path and signal, in 100 * dBm. */
const orderedNetworksSchema = z.tuple([
  z.array(z.tuple([z.string(), z.number()])),
]);

/** `RxBitrate` is in 100 kbit/s. */
const diagnosticsSchema = z.tuple([
  z.object({
    Frequency: variant(z.number()),
    RxBitrate: variant(z.number()),
  }),
]);

const propertiesChangedSchema = z.tuple([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.string()),
]);
