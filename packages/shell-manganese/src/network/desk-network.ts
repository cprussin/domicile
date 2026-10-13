import type { Option, Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { Network } from "@domicile-desktop/system-network/network";
import { watchNetwork } from "@domicile-desktop/system-network/network";
import type { Wifi } from "@domicile-desktop/system-network/wifi";
import { watchWifi } from "@domicile-desktop/system-network/wifi";

import { perHost } from "../host/per-host";
import type { SharedWatch } from "../readouts/shared-watch";
import { sharedWatch } from "../readouts/shared-watch";

export type DeskNetwork = {
  network: SharedWatch<Result<Network, SystemError>>;
  /** The Wi-Fi device; `None` without one. */
  wifi: SharedWatch<Result<Option<Wifi>, SystemError>>;
};

/** The network service, watched once for every bar. */
export const deskNetwork = perHost((domicile): DeskNetwork => {
  const host = system(domicile);
  return {
    network: sharedWatch((onNetwork) => watchNetwork(host, onNetwork)),
    wifi: sharedWatch((onWifi) => watchWifi(host, onWifi)),
  };
});
