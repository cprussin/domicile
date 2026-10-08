import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Bluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";
import { render, screen } from "@testing-library/react";

import { heldBattery } from "../battery/held-battery";
import { heldBacklight } from "../brightness/held-backlight";
import { sharedWatch } from "../readouts/shared-watch";
import { heldSound, laptop } from "../volume/fixture";
import { LockBar } from "./LockBar";

/**
 * The bar on a desk with every readout, reporting Bluetooth on. The network
 * throws if the bar watches it.
 */
const shown = () => {
  const battery = heldBattery();
  const backlight = heldBacklight();
  const sound = heldSound();
  render(
    <LockBar
      domicile={new FakeDomicileHost().host}
      readouts={{
        audio: sound.audio,
        backlight: backlight.backlight,
        battery: battery.battery,
        bluetooth: sharedWatch(
          (
            onBluetooth: (bluetooth: Result<Bluetooth, SystemError>) => void,
          ) => {
            onBluetooth(
              Ok({
                adapters: [
                  {
                    discovering: false,
                    path: "/org/bluez/hci0",
                    powered: true,
                  },
                ],
                devices: [],
              }),
            );
            return () => undefined;
          },
        ),
        network: sharedWatch(() => {
          throw new Error("test: the lock screen's bar has no network");
        }),
        sound: sound.server,
        wifi: sharedWatch(() => {
          throw new Error("test: the lock screen's bar has no Wi-Fi");
        }),
      }}
    />,
  );
  return { backlight, battery, sound };
};

describe("LockBar", () => {
  it("shows Bluetooth, volume, brightness and battery, as the desktop's bar does", () => {
    const { backlight, battery, sound } = shown();

    battery.report({ charge: 0.8, charging: false });
    backlight.report(0.42);
    sound.report(laptop);

    expect(
      [...screen.getByRole("banner").querySelectorAll("[aria-label]")].map(
        (item) => item.getAttribute("aria-label"),
      ),
    ).toEqual(["Bluetooth on", "Volume 50%", "Brightness 42%", "Battery"]);
  });

  it("shows Bluetooth without turning it on or off", () => {
    // A locked desk refuses it.
    shown();

    expect(screen.getByRole("img", { name: "Bluetooth on" })).toBeVisible();
  });
});
