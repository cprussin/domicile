import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { BatteryMessage } from "@domicile-desktop/sdk/host-message";

import { watchShared } from "../host/watch-shared";

/**
 * Watches the battery: calls `onReading` with each charge the host reports, and
 * returns a function that stops watching.
 *
 * Reads from the host, not `navigator.getBattery`. Chromium answers that via
 * UPower over D-Bus, which a bare tty lacks, and then reports a fake full,
 * charging battery. The compositor reads `/sys/class/power_supply` instead; see
 * `domicile_host::battery`.
 *
 * The host pushes the charge on connect and when it changes. The client keeps
 * the last message, so a bar mounted late still gets it.
 *
 * Shared by every bar on the page because `on` has a single slot; see
 * `watchShared`.
 */
export const watchBattery = (
  domicile: DomicileClient,
  onReading: (reading: BatteryMessage) => void,
): (() => void) => watchShared(domicile, "battery", onReading);
