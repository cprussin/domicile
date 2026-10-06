// NetworkManager over the system bus: connectivity and the primary
// connection, kept current. See docs/architecture/SYSTEM-ACCESS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DbusSignal,
  Listening,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

const SERVICE = "org.freedesktop.NetworkManager";
const ROOT = "/org/freedesktop/NetworkManager";
/** The object path NetworkManager uses for "none". */
const NO_OBJECT = "/";

/** Whether the host reaches the internet. */
export enum Connectivity {
  Unknown,
  None,
  /** Behind a captive portal. */
  Portal,
  /** On a network, without the internet. */
  Limited,
  Full,
}

export enum LinkKind {
  None,
  Wired,
  Wifi,
  Other,
}

/** The primary connection. `name` is the connection's name in NetworkManager. */
export const Link = {
  None: () => ({ kind: LinkKind.None as const }),
  /** A VPN, a bridge, a modem and the rest. */
  Other: (name: string) => ({ kind: LinkKind.Other as const, name }),
  /** `strength` is 0 through 1. */
  Wifi: (ssid: string, strength: number) => ({
    kind: LinkKind.Wifi as const,
    ssid,
    strength,
  }),
  Wired: (name: string) => ({ kind: LinkKind.Wired as const, name }),
};

export type Link = ReturnType<(typeof Link)[keyof typeof Link]>;

export type Network = { connectivity: Connectivity; link: Link };

/** The calls this library makes. */
export type NetworkSystem = Pick<System, "dbusCall" | "dbusMatch">;

/**
 * Calls `onNetwork` with the network now and after each change, and returns a
 * function that stops watching.
 *
 * An `Err` is a D-Bus failure, such as NetworkManager not running. The watch
 * keeps listening after one, so a later change reads again.
 */
export const watchNetwork = (
  system: NetworkSystem,
  onNetwork: (network: Result<Network, SystemError>) => void,
): (() => void) => {
  const watch: Watch = { listening: undefined, stopped: false };
  const report = (network: Result<Network, SystemError>) => {
    if (!watch.stopped) {
      onNetwork(network);
    }
  };
  follow(system, watch, report).catch((error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: surfacing a background failure
    console.error("Failed to watch the network", error);
  });
  return () => {
    watch.stopped = true;
    watch.listening?.stop();
  };
};

/** A watch's state, shared by its loop and its stop function. */
type Watch = {
  listening: Listening<DbusSignal> | undefined;
  stopped: boolean;
};

/** What one read found, and the objects whose changes affect it. */
type Read = {
  network: Result<Network, SystemError>;
  paths: ReadonlySet<string>;
};

/** Listen, read, then read again on each change until the match ends. */
const follow = async (
  system: NetworkSystem,
  watch: Watch,
  report: (network: Result<Network, SystemError>) => void,
): Promise<void> => {
  const matched = await system.dbusMatch({
    bus: Bus.System,
    interface: "org.freedesktop.DBus.Properties",
    member: "PropertiesChanged",
    sender: SERVICE,
  });
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

/** Read now, and again on each signal from an object the network uses. */
const changes = async (
  system: NetworkSystem,
  listening: Listening<DbusSignal>,
  report: (network: Result<Network, SystemError>) => void,
): Promise<void> => {
  const reader = listening.items.getReader();
  const first = await read(system);
  report(first.network);
  let paths = first.paths;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (paths.has(next.value.path)) {
      const again = await read(system);
      report(again.network);
      paths = again.paths;
    }
  }
};

const read = async (system: NetworkSystem): Promise<Read> => {
  const root = await properties(system, ROOT, SERVICE, rootSchema);
  return root.match({
    Err: (error) =>
      Promise.resolve({ network: Err(error), paths: new Set([ROOT]) }),
    Ok: async ({ Connectivity: connectivity, PrimaryConnection: primary }) => {
      const link = await linkOf(system, primary);
      return {
        network: link.result.map((found) => ({
          connectivity,
          link: found,
        })),
        paths: new Set([ROOT, ...link.paths]),
      };
    },
  });
};

/** The primary connection, and the objects read to find it. */
type FoundLink = { result: Result<Link, SystemError>; paths: string[] };

/** The primary connection at `path`. */
const linkOf = async (
  system: NetworkSystem,
  path: string,
): Promise<FoundLink> => {
  if (path === NO_OBJECT) {
    return { paths: [], result: Ok(Link.None()) };
  } else {
    const active = await properties(
      system,
      path,
      `${SERVICE}.Connection.Active`,
      activeSchema,
    );
    return active.match({
      Err: (error) => Promise.resolve({ paths: [path], result: Err(error) }),
      Ok: async ({
        Id: name,
        SpecificObject: specific,
        Type: type,
      }): Promise<FoundLink> => {
        switch (type) {
          case "802-11-wireless": {
            const point = await properties(
              system,
              specific,
              `${SERVICE}.AccessPoint`,
              accessPointSchema,
            );
            return {
              paths: [path, specific],
              result: point.map(({ Ssid: ssid, Strength: strength }) =>
                Link.Wifi(
                  new TextDecoder().decode(new Uint8Array(ssid)),
                  strength / 100,
                ),
              ),
            };
          }
          case "802-3-ethernet": {
            return { paths: [path], result: Ok(Link.Wired(name)) };
          }
          default: {
            return { paths: [path], result: Ok(Link.Other(name)) };
          }
        }
      },
    });
  }
};

/** `Properties.GetAll` on one of NetworkManager's objects, parsed. */
const properties = async <T extends NonNullable<unknown>>(
  system: NetworkSystem,
  path: string,
  interfaceName: string,
  schema: z.ZodType<T>,
): Promise<Result<T, SystemError>> =>
  (
    await system.dbusCall({
      body: [interfaceName],
      bus: Bus.System,
      destination: SERVICE,
      interface: "org.freedesktop.DBus.Properties",
      member: "GetAll",
      path,
      signature: "s",
    })
  ).map(({ body }) => z.tuple([schema]).parse(body)[0]);

/** A `v`, as `domicile_host::dbus_json` writes it, read as its value. */
const variant = <T>(value: z.ZodType<T>) =>
  z.object({ value }).transform(({ value: held }) => held);

/** NetworkManager's `NMConnectivityState`. */
const connectivityOf = (value: 0 | 1 | 2 | 3 | 4): Connectivity => {
  switch (value) {
    case 0: {
      return Connectivity.Unknown;
    }
    case 1: {
      return Connectivity.None;
    }
    case 2: {
      return Connectivity.Portal;
    }
    case 3: {
      return Connectivity.Limited;
    }
    case 4: {
      return Connectivity.Full;
    }
  }
};

const rootSchema = z.object({
  Connectivity: variant(
    z
      .union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ])
      .transform(connectivityOf),
  ),
  PrimaryConnection: variant(z.string()),
});

const activeSchema = z.object({
  Id: variant(z.string()),
  SpecificObject: variant(z.string()),
  Type: variant(z.string()),
});

const accessPointSchema = z.object({
  Ssid: variant(z.array(z.number())),
  Strength: variant(z.number()),
});
