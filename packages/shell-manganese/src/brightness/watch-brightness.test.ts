import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { watchBrightness } from "./watch-brightness";

describe("watchBrightness", () => {
  it("reports the level the host holds and every one it says after", () => {
    const fake = new FakeDomicileHost();
    fake.set({ brightness: 0.5 });
    const levels: number[] = [];

    watchBrightness(fake.host, (level) => {
      levels.push(level);
    });
    fake.set({ brightness: 0.42 });

    expect(levels).toEqual([0.5, 0.42]);
  });

  it("reports nothing for a machine with no backlight", () => {
    const fake = new FakeDomicileHost();
    const levels: number[] = [];

    watchBrightness(fake.host, (level) => {
      levels.push(level);
    });

    expect(levels).toEqual([]);
  });
});
