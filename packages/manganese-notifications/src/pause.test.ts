import { describe, expect, it } from "bun:test";

import { PauseLength, pausedFor, pauseEnd } from "./pause";

/** 2026-11-09 at `hour`:`minute`, local time, in ms since the epoch. */
const at = (hour: number, minute = 0, day = 9) =>
  new Date(2026, 10, day, hour, minute).getTime();

describe("pauseEnd", () => {
  it("ends an hour's pause an hour on", () => {
    expect(pauseEnd(PauseLength.Hour, at(14, 10))).toBe(at(15, 10));
  });

  it("ends a pause until tomorrow at 8 the next morning, even after midnight", () => {
    expect(pauseEnd(PauseLength.Tomorrow, at(22, 30))).toBe(at(8, 0, 10));
    expect(pauseEnd(PauseLength.Tomorrow, at(0, 30))).toBe(at(8, 0, 10));
  });

  it("never ends a pause until resumed", () => {
    expect(pauseEnd(PauseLength.UntilResumed, at(9))).toBeUndefined();
  });
});

describe("pausedFor", () => {
  it("says only that it is paused when it has no end", () => {
    expect(pausedFor({}, at(9))).toBe("Paused");
  });

  it("gives the time a pause ends today", () => {
    expect(pausedFor({ until: at(15) }, at(14))).toBe("Paused until 3:00 PM");
  });

  it("says when a pause ends another day", () => {
    expect(pausedFor({ until: at(8, 0, 10) }, at(22))).toBe(
      "Paused until tomorrow, 8:00 AM",
    );
  });
});
