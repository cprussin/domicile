import type { Result } from "@cprussin/option-result";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { Bluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";
import { watchBluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";

/** BlueZ, watched once for every bar and the lock screen. */
export const deskBluetooth = perHost(
  (domicile): SharedWatch<Result<Bluetooth, SystemError>> =>
    sharedWatch((onBluetooth) => watchBluetooth(system(domicile), onBluetooth)),
);
