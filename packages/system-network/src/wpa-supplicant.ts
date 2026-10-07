// wpa_supplicant over the system bus: the connected Wi-Fi network and its
// signal, kept current. See docs/SHELL-SYSTEM-ACCESS.md.

import { Err, Ok, Result } from "@cprussin/option-result";
import type { DbusSignal, SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import type { Reading } from "./follow";
import { followNetwork } from "./follow";
import type { Network, NetworkSystem } from "./network-state";
import { Connectivity, Link } from "./network-state";
import { strengthOfDbm } from "./signal-strength";
import { variant } from "./variant";

const SERVICE = "fi.w1.wpa_supplicant1";
const ROOT = "/fi/w1/wpa_supplicant1";

/**
 * Calls `onNetwork` with wpa_supplicant's network now and after each change,
 * and returns a function that stops watching. wpa_supplicant is on the bus
 * only when it runs with `-u`.
 *
 * wpa_supplicant knows only Wi-Fi: connectivity is always `Unknown`, and the
 * link is the connected Wi-Fi network or `None`. An `Err` is a D-Bus failure,
 * such as wpa_supplicant not on the bus. The watch keeps listening after one,
 * so a later change reads again.
 */
export const watchWpaSupplicant = (
  system: NetworkSystem,
  onNetwork: (network: Result<Network, SystemError>) => void,
): (() => void) =>
  followNetwork(
    system,
    { bus: Bus.System, sender: SERVICE },
    () => read(system),
    onNetwork,
  );

/**
 * Read the network. An interface coming or going matters, as does a property
 * change on an object read for it.
 */
const read = async (system: NetworkSystem): Promise<Reading> => {
  const found = await readPaths(system);
  return {
    matters: (signal) => matters(found.paths, signal),
    network: found.network.map((link) => ({
      connectivity: Connectivity.Unknown,
      link,
    })),
  };
};

/**
 * Whether `signal` can change the network. wpa_supplicant also sends its own
 * `PropertiesChanged` on each object's interface; only the standard one is
 * read.
 */
const matters = (paths: ReadonlySet<string>, signal: DbusSignal): boolean => {
  switch (signal.interface) {
    case SERVICE: {
      return (
        signal.member === "InterfaceAdded" ||
        signal.member === "InterfaceRemoved"
      );
    }
    case "org.freedesktop.DBus.Properties": {
      return signal.member === "PropertiesChanged" && paths.has(signal.path);
    }
    default: {
      return false;
    }
  }
};

/** What one read found, and the objects whose changes affect it. */
type Read = {
  network: Result<Link, SystemError>;
  paths: ReadonlySet<string>;
};

const readPaths = async (system: NetworkSystem): Promise<Read> => {
  const root = await properties(system, ROOT, SERVICE, rootSchema);
  return root.match({
    Err: (error) => Promise.resolve({ network: Err(error), paths: new Set() }),
    Ok: async ({ Interfaces: paths }) => {
      const interfaces = Result.collect(
        await Promise.all(
          paths.map(async (path) =>
            (
              await properties(
                system,
                path,
                `${SERVICE}.Interface`,
                interfaceSchema,
              )
            ).map((held) => ({ ...held, path })),
          ),
        ),
      );
      return interfaces.match({
        Err: (error) =>
          Promise.resolve({ network: Err(error), paths: new Set(paths) }),
        Ok: async (held) => {
          const connected = held.find(({ State: state }) => isOnline(state));
          return connected === undefined
            ? { network: Ok(Link.None()), paths: new Set(paths) }
            : {
                network: await linkOf(system, connected.CurrentBSS),
                paths: new Set([...paths, connected.CurrentBSS]),
              };
        },
      });
    },
  });
};

/**
 * Whether an interface in `state` is on its network. A group rekey moves a
 * connected interface from `completed` to `group_handshake` and back, so
 * `group_handshake` counts too.
 */
const isOnline = (state: InterfaceState): boolean => {
  switch (state) {
    case "completed":
    case "group_handshake": {
      return true;
    }
    case "disconnected":
    case "inactive":
    case "interface_disabled":
    case "scanning":
    case "authenticating":
    case "associating":
    case "associated":
    case "4way_handshake":
    case "unknown": {
      return false;
    }
  }
};

/** The network at the BSS `path`. */
const linkOf = async (
  system: NetworkSystem,
  path: string,
): Promise<Result<Link, SystemError>> =>
  (await properties(system, path, `${SERVICE}.BSS`, bssSchema)).map(
    ({ SSID: ssid, Signal: signal }) =>
      Link.Wifi(
        new TextDecoder().decode(new Uint8Array(ssid)),
        strengthOfDbm(signal),
      ),
  );

/** `Properties.GetAll` on one of wpa_supplicant's objects, parsed. */
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

const rootSchema = z.object({ Interfaces: variant(z.array(z.string())) });

/** `wpa_supplicant_state_txt`, lowercased. */
const interfaceStateSchema = z.enum([
  "disconnected",
  "inactive",
  "interface_disabled",
  "scanning",
  "authenticating",
  "associating",
  "associated",
  "4way_handshake",
  "group_handshake",
  "completed",
  "unknown",
]);

type InterfaceState = z.infer<typeof interfaceStateSchema>;

const interfaceSchema = z.object({
  CurrentBSS: variant(z.string()),
  State: variant(interfaceStateSchema),
});

const bssSchema = z.object({
  Signal: variant(z.number()),
  SSID: variant(z.array(z.number())),
});
