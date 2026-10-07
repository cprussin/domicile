// NetworkManager over the system bus: connectivity and the primary
// connection, kept current. See docs/SHELL-SYSTEM-ACCESS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import type { Reading } from "./follow";
import { followNetwork } from "./follow";
import type { Network, NetworkSystem } from "./network-state";
import { Connectivity, Link } from "./network-state";
import { variant } from "./variant";

const SERVICE = "org.freedesktop.NetworkManager";
const ROOT = "/org/freedesktop/NetworkManager";
/** The object path NetworkManager uses for "none". */
const NO_OBJECT = "/";

/**
 * Calls `onNetwork` with NetworkManager's network now and after each change,
 * and returns a function that stops watching.
 *
 * An `Err` is a D-Bus failure, such as NetworkManager not running. The watch
 * keeps listening after one, so a later change reads again.
 */
export const watchNetworkManager = (
  system: NetworkSystem,
  onNetwork: (network: Result<Network, SystemError>) => void,
): (() => void) =>
  followNetwork(
    system,
    {
      bus: Bus.System,
      interface: "org.freedesktop.DBus.Properties",
      member: "PropertiesChanged",
      sender: SERVICE,
    },
    () => read(system),
    onNetwork,
  );

/** Read the network; a change to any object read for it matters. */
const read = async (system: NetworkSystem): Promise<Reading> => {
  const root = await properties(system, ROOT, SERVICE, rootSchema);
  return root.match({
    Err: (error) =>
      Promise.resolve({
        matters: ({ path }) => path === ROOT,
        network: Err(error),
      }),
    Ok: async ({ Connectivity: connectivity, PrimaryConnection: primary }) => {
      const link = await linkOf(system, primary);
      const paths = new Set([ROOT, ...link.paths]);
      return {
        matters: ({ path }) => paths.has(path),
        network: link.result.map((found) => ({
          connectivity,
          link: found,
        })),
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
