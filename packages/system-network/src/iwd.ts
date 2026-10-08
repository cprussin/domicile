// iwd over the system bus: the connected Wi-Fi network and its signal, kept
// current. See docs/SHELL-SYSTEM-ACCESS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { DbusSignal, SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import { followBus } from "./follow";
import type { Network, NetworkSystem } from "./network-state";
import { Connectivity, Link } from "./network-state";
import { strengthOfDbm } from "./signal-strength";
import { variant } from "./variant";

const SERVICE = "net.connman.iwd";
const STATION = "net.connman.iwd.Station";
const NETWORK = "net.connman.iwd.Network";

/**
 * Station properties whose changes alter the network. A scan ending
 * (`Scanning`) refreshes the signal.
 */
const WATCHED = ["ConnectedNetwork", "Scanning", "State"];

/**
 * Calls `onNetwork` with iwd's network now and after each change, and returns
 * a function that stops watching.
 *
 * iwd knows only Wi-Fi: connectivity is always `Unknown`, and the link is the
 * connected Wi-Fi network or `None`. An `Err` is a D-Bus failure, such as iwd
 * not running. The watch keeps listening after one, so a later change reads
 * again.
 */
export const watchIwd = (
  system: NetworkSystem,
  onNetwork: (network: Result<Network, SystemError>) => void,
): (() => void) =>
  followBus(
    system,
    { bus: Bus.System, sender: SERVICE },
    async () => ({ matters, value: await read(system) }),
    onNetwork,
  );

/**
 * Whether `signal` can change the network: an object coming or going, or a
 * watched station property.
 */
const matters = (signal: DbusSignal): boolean => {
  switch (signal.member) {
    case "InterfacesAdded":
    case "InterfacesRemoved": {
      return true;
    }
    case "PropertiesChanged": {
      const [iface, changed] = propertiesChangedSchema.parse(signal.body);
      return iface === STATION && WATCHED.some((name) => name in changed);
    }
    default: {
      return false;
    }
  }
};

const read = async (
  system: NetworkSystem,
): Promise<Result<Network, SystemError>> => {
  const objects = await system.dbusCall({
    bus: Bus.System,
    destination: SERVICE,
    interface: "org.freedesktop.DBus.ObjectManager",
    member: "GetManagedObjects",
    path: "/",
  });
  return objects.match({
    Err: (error) => Promise.resolve(Err(error)),
    Ok: async ({ body }) =>
      (await linkOf(system, managedObjectsSchema.parse(body)[0])).map(
        (link) => ({ connectivity: Connectivity.Unknown, link }),
      ),
  });
};

/** The first connected station's network, or `None`. */
const linkOf = async (
  system: NetworkSystem,
  objects: ManagedObjects,
): Promise<Result<Link, SystemError>> => {
  const station = Object.entries(objects).flatMap(([path, held]) =>
    held[STATION] !== undefined && isOnline(held[STATION].State)
      ? [{ network: connectedNetwork(path, held[STATION]), path }]
      : [],
  )[0];
  if (station === undefined) {
    return Ok(Link.None());
  } else {
    const ordered = await system.dbusCall({
      bus: Bus.System,
      destination: SERVICE,
      interface: STATION,
      member: "GetOrderedNetworks",
      path: station.path,
    });
    return ordered.map(({ body }) =>
      Link.Wifi(
        nameOf(objects, station.network),
        strengthOfDbm(
          signalOf(orderedNetworksSchema.parse(body)[0], station.network) / 100,
        ),
      ),
    );
  }
};

/** Whether a station in `state` is on its network. */
const isOnline = (state: StationState): boolean => {
  switch (state) {
    case "connected":
    case "roaming": {
      return true;
    }
    case "connecting":
    case "disconnecting":
    case "disconnected": {
      return false;
    }
  }
};

const connectedNetwork = (path: string, station: Station): string => {
  if (station.ConnectedNetwork === undefined) {
    throw new Error(`iwd's station ${path} is online with no network`);
  } else {
    return station.ConnectedNetwork;
  }
};

const nameOf = (objects: ManagedObjects, network: string): string => {
  const held = objects[network]?.[NETWORK];
  if (held === undefined) {
    throw new Error(`iwd has no network at ${network}`);
  } else {
    return held.Name;
  }
};

/** `network`'s signal, in 100 * dBm, from `GetOrderedNetworks`. */
const signalOf = (
  ordered: readonly (readonly [string, number])[],
  network: string,
): number => {
  const found = ordered.find(([path]) => path === network);
  if (found === undefined) {
    throw new Error(`iwd did not order its connected network ${network}`);
  } else {
    return found[1];
  }
};

const stationStateSchema = z.enum([
  "connected",
  "connecting",
  "disconnected",
  "disconnecting",
  "roaming",
]);

type StationState = z.infer<typeof stationStateSchema>;

const stationSchema = z.object({
  ConnectedNetwork: variant(z.string()).optional(),
  State: variant(stationStateSchema),
});

type Station = z.infer<typeof stationSchema>;

const managedObjectsSchema = z.tuple([
  z.record(
    z.string(),
    z.object({
      [NETWORK]: z.object({ Name: variant(z.string()) }).optional(),
      [STATION]: stationSchema.optional(),
    }),
  ),
]);

type ManagedObjects = z.infer<typeof managedObjectsSchema>[0];

const orderedNetworksSchema = z.tuple([
  z.array(z.tuple([z.string(), z.number()])),
]);

const propertiesChangedSchema = z.tuple([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.string()),
]);
