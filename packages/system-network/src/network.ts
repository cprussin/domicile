// The network from whichever network service runs: NetworkManager, iwd or
// wpa_supplicant. The package's entry point: it also forwards the network
// types, which live in `network-state` so the backends can import them
// without a cycle. See docs/SHELL-SYSTEM-ACCESS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import { watchIwd } from "./iwd";
import type { Network, NetworkSystem } from "./network-state";
import { watchNetworkManager } from "./networkmanager";
import { watchWpaSupplicant } from "./wpa-supplicant";

export type { Network, NetworkSystem } from "./network-state";
export { Connectivity, Link, LinkKind } from "./network-state";

/** A backend's watch; each has {@link watchNetwork}'s contract. */
type WatchBackend = typeof watchNetworkManager;

/** Each backend's bus name, in the order they are tried. */
const BACKENDS: readonly (readonly [string, WatchBackend])[] = [
  ["org.freedesktop.NetworkManager", watchNetworkManager],
  ["net.connman.iwd", watchIwd],
  ["fi.w1.wpa_supplicant1", watchWpaSupplicant],
];

/**
 * Calls `onNetwork` with the network now and after each change, and returns a
 * function that stops watching.
 *
 * Watches the first of NetworkManager, iwd and wpa_supplicant that is on the
 * system bus when called, or NetworkManager when none is; see each backend's
 * watch. An `Err` is a D-Bus failure, such as none of them running. When the
 * bus cannot say which runs, the watch reports that `Err` and ends.
 */
export const watchNetwork = (
  system: NetworkSystem,
  onNetwork: (network: Result<Network, SystemError>) => void,
): (() => void) => {
  const watch: Watch = { stop: undefined, stopped: false };
  detect(system, BACKENDS)
    .then((found) => {
      if (!watch.stopped) {
        found.match({
          Err: (error) => {
            onNetwork(Err(error));
          },
          Ok: (backend) => {
            watch.stop = backend(system, onNetwork);
          },
        });
      }
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a background failure
      console.error("Failed to find a network service", error);
    });
  return () => {
    watch.stopped = true;
    watch.stop?.();
  };
};

/** A watch's state, shared by its detection and its stop function. */
type Watch = { stop: (() => void) | undefined; stopped: boolean };

/** The first backend whose service has an owner on the bus. */
const detect = async (
  system: NetworkSystem,
  backends: readonly (readonly [string, WatchBackend])[],
): Promise<Result<WatchBackend, SystemError>> => {
  const [first, ...rest] = backends;
  if (first === undefined) {
    return Ok(watchNetworkManager);
  } else {
    const [name, backend] = first;
    const owned = await hasOwner(system, name);
    return owned.match({
      Err: (error) => Promise.resolve(Err(error)),
      Ok: (has) => (has ? Promise.resolve(Ok(backend)) : detect(system, rest)),
    });
  }
};

/**
 * Whether `name` has an owner. `NameHasOwner` does not start a service that
 * D-Bus can activate, as a call to the service would.
 */
const hasOwner = async (
  system: NetworkSystem,
  name: string,
): Promise<Result<boolean, SystemError>> =>
  (
    await system.dbusCall({
      body: [name],
      bus: Bus.System,
      destination: "org.freedesktop.DBus",
      interface: "org.freedesktop.DBus",
      member: "NameHasOwner",
      path: "/org/freedesktop/DBus",
      signature: "s",
    })
  ).map(({ body }) => z.tuple([z.boolean()]).parse(body)[0]);
