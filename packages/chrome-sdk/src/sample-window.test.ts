import { describe, expect, it } from "bun:test";

import { SampleWindow } from "./sample-window";

describe("SampleWindow", () => {
  it("has nothing to report when nothing was recorded", () => {
    expect(new SampleWindow().take()).toBeUndefined();
  });

  it("reports the average and the worst case", () => {
    // A path that is usually quick and occasionally terrible is what a stutter
    // is, and an average alone hides exactly that.
    const window = new SampleWindow();
    window.record(2);
    window.record(10);
    window.record(6);

    expect(window.take()).toEqual({ averageMs: 6, count: 3, worstMs: 10 });
  });

  it("starts a fresh window when taken", () => {
    const window = new SampleWindow();
    window.record(100);
    window.take();
    window.record(1);

    expect(window.take()).toEqual({ averageMs: 1, count: 1, worstMs: 1 });
  });
});
