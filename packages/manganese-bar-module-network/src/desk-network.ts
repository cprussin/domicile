import type { Option, Result } from "@cprussin/option-result";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type {
  Addressing,
  NetworkInterface,
} from "@domicile-desktop/system-network/interfaces";
import {
  watchAddresses,
  watchInterfaces,
} from "@domicile-desktop/system-network/interfaces";
import type { Network } from "@domicile-desktop/system-network/network";
import { watchNetwork } from "@domicile-desktop/system-network/network";
import type { Wifi } from "@domicile-desktop/system-network/wifi";
import { watchWifi } from "@domicile-desktop/system-network/wifi";
import { watchAcrossLocks } from "./across-locks";

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
 * The network service and hardware, watched once for every bar. The calls
 * that reach past `/sys` are refused while the desktop is locked, so those
 * watches start again on unlock.
 */
export const deskNetwork = perHost((domicile): DeskNetwork => {
  const host = desktop(domicile);
  return {
    addresses: sharedWatch(
      watchAcrossLocks(domicile, (onAddresses) =>
        watchAddresses(host, onAddresses),
      ),
    ),
    interfaces: sharedWatch((onInterfaces) =>
      watchInterfaces(host, onInterfaces),
    ),
    network: sharedWatch(
      watchAcrossLocks(domicile, (onNetwork) => watchNetwork(host, onNetwork)),
    ),
    wifi: sharedWatch(
      watchAcrossLocks(domicile, (onWifi) => watchWifi(host, onWifi)),
    ),
  };
});
