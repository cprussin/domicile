import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import { watchHost } from "../host/watch-host";

/** The charge, 0 through 1, and whether a lead is in. */
export type BatteryReading = {
  charge: number;
  charging: boolean;
};

/**
 * Watch the machine's battery: `onReading` is called with the charge as soon
 * as the host has said one and again whenever it moves, and what comes back
 * stops it.
 *
 * **The host, not `navigator.getBattery`.** The Battery Status API is the
 * obvious way for a page to read this and is the reason the bar shipped
 * saying `100%` on a machine running flat: it answers through UPower over
 * D-Bus, a desktop on a bare tty has neither, and Chromium resolves with its
 * default `BatteryStatus` — charging, and full. That default is a
 * plausible-looking reading, indistinguishable from a real laptop on a full
 * battery, so no page can tell it from the truth. The compositor reads
 * `/sys/class/power_supply`, which is in every kernel and wants no daemon —
 * see `domicile_host::battery`.
 *
 * Nothing is asked for. The charge is an attribute of the host, moved when it
 * moves far enough to draw — so a bar mounted a beat after the handshake reads
 * the reading that crossed in between.
 */
export const watchBattery = (
  domicile: DomicileHost,
  onReading: (reading: BatteryReading) => void,
): (() => void) => watchHost(domicile, "batterychanged", readingOf, onReading);

/** The charge the host holds, or `undefined` before it has said one. */
const readingOf = ({
  batteryCharge,
  batteryCharging,
}: DomicileHost): BatteryReading | undefined =>
  batteryCharge === null || batteryCharging === null
    ? undefined
    : { charge: batteryCharge, charging: batteryCharging };
