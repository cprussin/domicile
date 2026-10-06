import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import { watchHost } from "../host/watch-host";

/** The charge, 0 through 1, and whether it is charging. */
export type BatteryReading = {
  charge: number;
  charging: boolean;
};

/**
 * Watches the battery: calls `onReading` with each charge the host reports, and
 * returns a function that stops watching.
 *
 * Reads from the host, not `navigator.getBattery`. Chromium answers that via
 * UPower over D-Bus, which a bare tty lacks, and then reports a fake full,
 * charging battery. The compositor reads `/sys/class/power_supply` instead; see
 * `domicile_host::battery`.
 *
 * The charge is an attribute of the host, so a bar mounted late reads the
 * current reading.
 */
export const watchBattery = (
  domicile: DomicileHost,
  onReading: (reading: BatteryReading) => void,
): (() => void) => watchHost(domicile, "batterychanged", readingOf, onReading);

/** The host's charge, or `undefined` before it has one. */
const readingOf = ({
  batteryCharge,
  batteryCharging,
}: DomicileHost): BatteryReading | undefined =>
  batteryCharge === null || batteryCharging === null
    ? undefined
    : { charge: batteryCharge, charging: batteryCharging };
