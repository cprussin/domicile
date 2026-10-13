import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { Bluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";
import { watchBluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";

import { perHost } from "../host/per-host";
import type { SharedWatch } from "../readouts/shared-watch";
import { sharedWatch } from "../readouts/shared-watch";

/** BlueZ, watched once for every bar and the lock screen. */
export const deskBluetooth = perHost(
  (domicile): SharedWatch<Result<Bluetooth, SystemError>> =>
    sharedWatch((onBluetooth) => watchBluetooth(system(domicile), onBluetooth)),
);
