import { describe, expect, it } from "bun:test";

import { RoundTripWindow } from "./round-trip";

describe("RoundTripWindow", () => {
  it("has nothing to report before a keystroke is answered", () => {
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);

    expect(window.take()).toBeUndefined();
  });

  it("measures a keystroke from when it was sent to the frame that answered it", () => {
    const window = new RoundTripWindow();
    window.keyed("app-1", 100);
    window.drew("app-1", 180);

    expect(window.take()).toEqual({ averageMs: 80, count: 1, worstMs: 80 });
  });

  it("measures a burst from its oldest keystroke", () => {
    // One frame can answer several keystrokes, and the felt lag is how long the
    // *first* character waited — measuring from the last would report the
    // latency of the fastest one and call the burst fast.
    const window = new RoundTripWindow();
    window.keyed("app-1", 100);
    window.keyed("app-1", 120);
    window.keyed("app-1", 140);
    window.drew("app-1", 200);

    expect(window.take()).toEqual({ averageMs: 100, count: 1, worstMs: 100 });
  });

  it("reports the average and the worst case", () => {
    // A path that is usually quick and occasionally terrible is what a stutter
    // is, and an average alone hides exactly that.
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);
    window.drew("app-1", 20);
    window.keyed("app-1", 100);
    window.drew("app-1", 400);

    expect(window.take()).toEqual({ averageMs: 160, count: 2, worstMs: 300 });
  });

  it("ignores a frame nobody was waiting on", () => {
    // A terminal redraws its blinking cursor with no input behind it; counting
    // that as a round trip would report the blink interval as input latency.
    const window = new RoundTripWindow();
    window.drew("app-1", 500);

    expect(window.take()).toBeUndefined();
  });

  it("does not let one app's frame answer another's keystroke", () => {
    const window = new RoundTripWindow();
    window.keyed("app-1", 100);
    window.drew("app-2", 150);

    expect(window.take()).toBeUndefined();
  });

  it("starts a fresh window when taken", () => {
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);
    window.drew("app-1", 900);
    window.take();

    window.keyed("app-1", 1000);
    window.drew("app-1", 1010);

    expect(window.take()).toEqual({ averageMs: 10, count: 1, worstMs: 10 });
  });
});
