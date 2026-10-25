import { describe, expect, it } from "bun:test";

import { colorTemperature, NEUTRAL } from "./color-temperature";
import type { NightLightSettings } from "./night-light";
import { nightLight } from "./night-light";
import type { Override } from "./night-light-override";
import { Schedule } from "./night-light-schedule";

const LATE: NightLightSettings = {
  schedule: Schedule.Hours({ from: 22 * 60, to: 7 * 60 }),
  warmth: 50,
};
const BY_HAND: NightLightSettings = { schedule: undefined, warmth: 50 };
const WARM = colorTemperature(50, 1);

/** A night light on a clock at `start`, whose `tick` moves the clock. */
const desk = (start: string, override?: Override) => {
  const clock = { now: new Date(start) };
  const tints: number[] = [];
  const kept: { override: Override | undefined } = { override };
  const ticks = new Set<() => void>();
  const light = nightLight({
    every: (_ms, tick) => {
      ticks.add(tick);
      return () => {
        ticks.delete(tick);
      };
    },
    now: () => clock.now,
    store: (next) => {
      kept.override = next;
    },
    stored: () => kept.override,
    tint: (kelvin) => {
      tints.push(kelvin);
    },
  });
  return {
    kept,
    light,
    tick: (to: string) => {
      clock.now = new Date(to);
      for (const tick of ticks) {
        tick();
      }
    },
    ticks,
    tints,
  };
};

describe("nightLight", () => {
  it("tints the screen on its schedule", () => {
    const { light, tick, tints } = desk("2026-11-10T15:00");
    light.run(LATE);

    tick("2026-11-10T15:01");
    tick("2026-11-10T23:00");
    tick("2026-11-11T08:00");

    expect(tints).toEqual([NEUTRAL, WARM, NEUTRAL]);
  });

  it("reports whether it is on", () => {
    const { light, tick } = desk("2026-11-10T15:00");
    light.run(LATE);
    const heard: boolean[] = [];
    light.on.subscribe(() => {
      heard.push(light.on.current() ?? false);
    });

    tick("2026-11-10T23:00");

    expect(heard).toEqual([true]);
  });

  it("turns on by hand until the night's end", () => {
    const { kept, light, tick, tints } = desk("2026-11-10T15:00");
    light.run(LATE);

    light.toggle();
    tick("2026-11-11T06:59");
    tick("2026-11-11T07:00");

    expect(tints).toEqual([NEUTRAL, WARM, NEUTRAL]);
    expect(kept.override).toBeUndefined();
  });

  it("turns off by hand until the night's end", () => {
    const { light, tick, tints } = desk("2026-11-10T23:00");
    light.run(LATE);

    light.toggle();
    tick("2026-11-11T03:00");
    tick("2026-11-11T22:30");

    expect(tints).toEqual([WARM, NEUTRAL, WARM]);
  });

  it("turns back to the schedule by hand", () => {
    const { kept, light } = desk("2026-11-10T23:00");
    light.run(LATE);

    light.toggle();
    light.toggle();

    expect(kept.override).toBeUndefined();
    expect(light.on.current()).toBe(true);
  });

  it("stays on by hand for good without a schedule", () => {
    const { kept, light, tick, tints } = desk("2026-11-10T15:00");
    light.run(BY_HAND);

    light.toggle();
    tick("2026-12-25T15:00");

    expect(tints).toEqual([NEUTRAL, WARM]);
    expect(kept.override).toEqual({ on: true });
  });

  it("keeps an override from before a reload", () => {
    const { light, tints } = desk("2026-11-10T15:00", { on: true });

    light.run(BY_HAND);

    expect(tints).toEqual([WARM]);
  });

  it("tints with new settings", () => {
    const { light, tints } = desk("2026-11-10T23:00");
    const stop = light.run(LATE);

    stop();
    light.run({ ...LATE, warmth: 100 });

    expect(tints).toEqual([WARM, colorTemperature(100, 1)]);
  });

  it("stops following its schedule when it stops", () => {
    const { light, ticks } = desk("2026-11-10T23:00");

    light.run(LATE)();

    expect(ticks.size).toBe(0);
  });
});
