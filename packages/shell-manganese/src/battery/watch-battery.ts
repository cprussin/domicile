import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { BatteryMessage } from "@domicile/chrome-sdk/host-message";

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
 * Nothing is asked for. The charge is pushed when it moves far enough to draw
 * and once more to a page that has just connected, and the client holds a
 * message that arrived before this registered — so a bar mounted a beat after
 * the handshake still gets the reading that crossed in between.
 */
export const watchBattery = (
  domicile: DomicileClient,
  onReading: (reading: BatteryMessage) => void,
): (() => void) => {
  domicile.on("battery", onReading);
  return () => {
    domicile.off("battery", onReading);
  };
};
