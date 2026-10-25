import { describe, expect, it } from "bun:test";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { OffsetStore } from "./auto-brightness";
import { runAutoBrightness } from "./auto-brightness";
import { brightnessFor } from "./auto-brightness-curve";
import type { Every } from "./every";
import type { SharedBacklight } from "./shared-backlight";

/** A backlight at `level` that records each level asked for. */
const backlightAt = (level: number | undefined) => {
  const reports: ((level: number) => void)[] = [];
  const chosen: ((level: number) => void)[] = [];
  const adjusted: number[] = [];
  const backlight: SharedBacklight = {
    adjust: (to) => {
      adjusted.push(to);
    },
    chosen: (listener) => {
      chosen.push(listener);
      return () => undefined;
    },
    level: sharedWatch((onLevel: (level: number) => void) => {
      reports.push(onLevel);
      if (level !== undefined) {
        onLevel(level);
      }
      return () => undefined;
    }),
    set: (to) => {
      for (const listener of chosen) {
        listener(to);
      }
    },
  };
  return {
    adjusted,
    backlight,
    report: (to: number) => {
      for (const onLevel of reports) {
        onLevel(to);
      }
    },
  };
};

/** A sensor whose `read` sends a level. */
const room = () => {
  const listeners: ((lux: number) => void)[] = [];
  return {
    light: (onLux: (lux: number) => void) => {
      listeners.push(onLux);
      return () => undefined;
    },
    read: (lux: number) => {
      for (const onLux of listeners) {
        onLux(lux);
      }
    },
  };
};

/** Timers that tick only when told to. */
const ticker = () => {
  const ticks = new Set<() => void>();
  const every: Every = (_ms, tick) => {
    ticks.add(tick);
    return () => {
      ticks.delete(tick);
    };
  };
  return {
    every,
    running: () => ticks.size,
    tickUntilDone: (limit = 1000) => {
      for (let count = 0; count < limit && ticks.size > 0; count += 1) {
        for (const tick of [...ticks]) {
          tick();
        }
      }
    },
  };
};

const memory = (offset = 0) => {
  const stored = { offset };
  const store: OffsetStore = {
    learn: (learned) => {
      stored.offset = learned;
    },
    learned: () => stored.offset,
  };
  return { store, stored };
};

describe("runAutoBrightness", () => {
  it("eases the backlight to the room's level", () => {
    const desk = backlightAt(0.2);
    const sensor = room();
    const timers = ticker();
    runAutoBrightness(
      desk.backlight,
      sensor.light,
      timers.every,
      memory().store,
    );

    sensor.read(100);
    timers.tickUntilDone();

    expect(desk.adjusted.at(-1)).toBeCloseTo(brightnessFor(100, 0));
    expect(desk.adjusted.length).toBeGreaterThan(10);
    for (const [index, level] of desk.adjusted.entries()) {
      expect(level - (desk.adjusted[index - 1] ?? 0.2)).toBeLessThanOrEqual(
        0.010_000_1,
      );
    }
  });

  it("ignores a small change in the light", () => {
    const desk = backlightAt(brightnessFor(100, 0));
    const sensor = room();
    const timers = ticker();
    runAutoBrightness(
      desk.backlight,
      sensor.light,
      timers.every,
      memory().store,
    );

    sensor.read(110);

    expect(timers.running()).toBe(0);
    expect(desk.adjusted).toEqual([]);
  });

  it("waits for the backlight's level", () => {
    const desk = backlightAt(undefined);
    const sensor = room();
    const timers = ticker();
    runAutoBrightness(
      desk.backlight,
      sensor.light,
      timers.every,
      memory().store,
    );
    sensor.read(10_000);

    desk.report(0.3);
    timers.tickUntilDone();

    expect(desk.adjusted.at(-1)).toBe(1);
  });

  it("learns the level the user chose", () => {
    const desk = backlightAt(0.2);
    const sensor = room();
    const timers = ticker();
    const { store, stored } = memory();
    runAutoBrightness(desk.backlight, sensor.light, timers.every, store);
    sensor.read(100);
    timers.tickUntilDone();

    desk.backlight.set(brightnessFor(100, 0) - 0.2);
    desk.adjusted.length = 0;
    sensor.read(10);
    timers.tickUntilDone();

    expect(stored.offset).toBeCloseTo(-0.2);
    expect(desk.adjusted.at(-1)).toBeCloseTo(brightnessFor(10, -0.2));
  });

  it("stops easing once the user chooses", () => {
    const desk = backlightAt(0.2);
    const sensor = room();
    const timers = ticker();
    runAutoBrightness(
      desk.backlight,
      sensor.light,
      timers.every,
      memory().store,
    );
    sensor.read(10_000);

    desk.backlight.set(0.5);

    expect(timers.running()).toBe(0);
  });

  it("starts from what it learned before", () => {
    const desk = backlightAt(0.2);
    const sensor = room();
    const timers = ticker();
    runAutoBrightness(
      desk.backlight,
      sensor.light,
      timers.every,
      memory(0.15).store,
    );

    sensor.read(100);
    timers.tickUntilDone();

    expect(desk.adjusted.at(-1)).toBeCloseTo(brightnessFor(100, 0.15));
  });

  it("stops easing when it stops", () => {
    const desk = backlightAt(0.2);
    const sensor = room();
    const timers = ticker();
    const stop = runAutoBrightness(
      desk.backlight,
      sensor.light,
      timers.every,
      memory().store,
    );
    sensor.read(10_000);

    stop();

    expect(timers.running()).toBe(0);
  });
});
