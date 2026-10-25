import { describe, expect, it } from "bun:test";

import type { Backlight } from "./host-backlight";
import { sharedBacklight } from "./shared-backlight";

/** A backlight that records each level asked of it. */
const recorded = () => {
  const asked: number[] = [];
  const backlight: Backlight = {
    set: (level) => {
      asked.push(level);
    },
    watch: () => () => undefined,
  };
  return { asked, backlight };
};

describe("sharedBacklight", () => {
  it("tells who listens each level the user chose", async () => {
    const { asked, backlight } = recorded();
    const shared = sharedBacklight(backlight);

    const chosen = new Promise((resolve) => {
      shared.chosen(resolve);
    });
    shared.set(0.4);

    expect(await chosen).toBe(0.4);
    expect(asked).toEqual([0.4]);
  });

  it("sets an automatic level without telling them", () => {
    const { asked, backlight } = recorded();
    const shared = sharedBacklight(backlight);
    const heard: number[] = [];
    const stop = shared.chosen((level) => {
      heard.push(level);
    });

    shared.adjust(0.7);
    stop();
    shared.set(0.2);

    expect(asked).toEqual([0.7, 0.2]);
    expect(heard).toEqual([]);
  });
});
