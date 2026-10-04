import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import type { BatteryReading } from "./watch-battery";
import { watchBattery } from "./watch-battery";

describe("watchBattery", () => {
  it("reports the charge the host holds and every one it says after", () => {
    const fake = new FakeDomicileHost();
    fake.set({ batteryCharge: 0.5, batteryCharging: false });
    const readings: BatteryReading[] = [];

    watchBattery(fake.host, (reading) => {
      readings.push(reading);
    });
    fake.set({ batteryCharge: 0.49, batteryCharging: true });

    expect(readings).toEqual([
      { charge: 0.5, charging: false },
      { charge: 0.49, charging: true },
    ]);
  });

  it("reports nothing for a machine that has said no charge", () => {
    const fake = new FakeDomicileHost();
    const readings: BatteryReading[] = [];

    watchBattery(fake.host, (reading) => {
      readings.push(reading);
    });

    expect(readings).toEqual([]);
  });
});
