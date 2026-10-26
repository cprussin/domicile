// The network for a React shell: one watch per desktop, however many parts
// read it.

import type { Option, Result } from "@cprussin/option-result";
import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import { useDeskWatch } from "@domicile-desktop/react/use-shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";

import { watchAcrossLocks } from "./across-locks";
import type { Addressing, NetworkInterface } from "./interfaces";
import { watchAddresses, watchInterfaces } from "./interfaces";
import { watchNetwork } from "./network";
import type { Network } from "./network-state";
import { watchWifi } from "./wifi";
import type { Wifi } from "./wifi-state";

export type DeskNetwork = {
  network: SharedWatch<Result<Network, SystemError>>;
  /** The network hardware. */
  interfaces: SharedWatch<Result<NetworkInterface[], SystemError>>;
  /** Each interface's addresses, by name. */
  addresses: SharedWatch<Result<Map<string, Addressing>, SystemError>>;
  /** The Wi-Fi device; `None` without one. */
  wifi: SharedWatch<Result<Option<Wifi>, SystemError>>;
};

/**
 * The network service and hardware, watched once per desktop. The calls that
 * reach past `/sys` are refused while the desktop is locked, so those watches
 * start again on unlock.
 */
export const deskNetwork = perDesktop(
  (domicile): DeskNetwork => ({
    addresses: sharedWatch(
      watchAcrossLocks(domicile, (onAddresses) =>
        watchAddresses(domicile, onAddresses),
      ),
    ),
    interfaces: sharedWatch((onInterfaces) =>
      watchInterfaces(domicile, onInterfaces),
    ),
    network: sharedWatch(
      watchAcrossLocks(domicile, (onNetwork) =>
        watchNetwork(domicile, onNetwork),
      ),
    ),
    wifi: sharedWatch(
      watchAcrossLocks(domicile, (onWifi) => watchWifi(domicile, onWifi)),
    ),
  }),
);

const part =
  <K extends keyof DeskNetwork>(key: K) =>
  (domicile: Domicile): DeskNetwork[K] =>
    deskNetwork(domicile)[key];

/** NetworkManager's state, or `undefined` before it says. */
export const useNetwork = (): Result<Network, SystemError> | undefined =>
  useDeskWatch(part("network"));

/** The network hardware, or `undefined` before it was read. */
export const useNetworkInterfaces = ():
  | Result<NetworkInterface[], SystemError>
  | undefined => useDeskWatch(part("interfaces"));

/** Each interface's addresses by name, or `undefined` before they were read. */
export const useAddresses = ():
  | Result<Map<string, Addressing>, SystemError>
  | undefined => useDeskWatch(part("addresses"));

/** The Wi-Fi device (`None` without one), or `undefined` before it was read. */
export const useWifi = (): Result<Option<Wifi>, SystemError> | undefined =>
  useDeskWatch(part("wifi"));
