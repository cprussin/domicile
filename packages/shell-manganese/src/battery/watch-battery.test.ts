import { describe, expect, it } from "bun:test";

import type { BatteryReading } from "./watch-battery";
import { watchBattery } from "./watch-battery";

/**
 * The battery the platform would answer with, which the test drives: the two
 * events the API emits are the two this watcher is listening for.
 */
class FakeBattery extends EventTarget {
  charging = false;
  level = 0.5;

  drainTo(level: number) {
    this.level = level;
    this.dispatchEvent(new Event("levelchange"));
  }

  plugIn() {
    this.charging = true;
    this.dispatchEvent(new Event("chargingchange"));
  }
}

/**
 * The platform answering. A tick of the microtask queue is what the watcher
 * needs to have subscribed, because the API hands back a promise.
 */
const answers = (battery: FakeBattery) => () => Promise.resolve(battery);

describe("watchBattery", () => {
  it("reports the battery it finds, and again whenever it changes", async () => {
    const battery = new FakeBattery();
    const readings: BatteryReading[] = [];

    const stop = watchBattery((reading) => {
      readings.push(reading);
    }, answers(battery));
    await Promise.resolve();
    battery.drainTo(0.25);
    battery.plugIn();
    stop();

    expect(readings).toEqual([
      { charging: false, level: 0.5 },
      { charging: false, level: 0.25 },
      { charging: true, level: 0.25 },
    ]);
  });

  it("takes its listeners off when it is stopped", async () => {
    const battery = new FakeBattery();
    const readings: BatteryReading[] = [];
    const stop = watchBattery((reading) => {
      readings.push(reading);
    }, answers(battery));
    await Promise.resolve();

    stop();
    battery.drainTo(0.25);

    expect(readings).toHaveLength(1);
  });

  it("reports nothing when it is stopped before the platform answers", async () => {
    const battery = new FakeBattery();
    const readings: BatteryReading[] = [];

    const stop = watchBattery((reading) => {
      readings.push(reading);
    }, answers(battery));
    stop();
    await Promise.resolve();

    expect(readings).toEqual([]);
  });
});
