import { describe, expect, it } from "bun:test";

import { diagnosticLines } from "./diagnostic-lines";

const sample = (count: number, averageMs: number, worstMs: number) => ({
  averageMs,
  count,
  worstMs,
});

const nothing = {
  draw: undefined,
  ipc: undefined,
  place: undefined,
  trip: undefined,
};

describe("diagnosticLines", () => {
  it("says nothing about a desktop that did nothing", () => {
    // The log is read by a person watching for a number that changed. A line
    // of zeroes every interval is what stops anyone reading it.
    expect(diagnosticLines(nothing)).toStrictEqual([]);
  });

  it("reports what windows cost even when nobody typed", () => {
    // The case this measurement exists for: a desktop sitting there, paying
    // for every window on every frame. Reporting it only alongside a keystroke
    // would hide the number in exactly the situation it describes.
    const lines = diagnosticLines({ ...nothing, place: sample(1180, 0.4, 2) });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("placements=1180");
  });

  it("reports a cost too small to print in whole milliseconds", () => {
    // One measurement is sub-millisecond by construction, so whole
    // milliseconds print every one of them as zero — and the reader, told to
    // multiply a count by an average, gets nothing. These are the numbers that
    // say a desktop spends most of half a second per five on measuring windows
    // nobody is looking at, which is the answer this line exists to give.
    const [line] = diagnosticLines({
      ...nothing,
      place: sample(1180, 0.4, 0.1),
    });

    expect(line).toContain("place_total_ms=472");
    expect(line).toContain("place_ms=0.40");
    expect(line).toContain("place_worst_ms=0.10");
  });

  it("drops frame stages an interval has no keystroke to bill them to", () => {
    // `ipc` and `draw` are the stages *inside* a round trip, and frames arrive
    // with no keystroke behind them all the time — a blinking cursor, a video.
    // Carrying them forward would bill them to whichever keystroke came next,
    // which is the one thing a per-keystroke number must not do.
    expect(
      diagnosticLines({
        ...nothing,
        draw: sample(44, 1, 3),
        ipc: sample(44, 2, 5),
      }),
    ).toStrictEqual([]);
  });

  it("keeps the keystroke and the windows on separate lines", () => {
    // Different subjects on different clocks: one is per keystroke and the
    // other per window per frame, so a reader who put them on one line would
    // be dividing one count into the other's total.
    const lines = diagnosticLines({
      draw: sample(44, 1, 3),
      ipc: sample(44, 2, 5),
      place: sample(1180, 0.4, 2),
      trip: sample(3, 18, 31),
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("round trip keys=3");
    expect(lines[0]).not.toContain("placements");
    expect(lines[1]).toContain("placements=1180");
  });

  it("still reports a keystroke whose frames it saw nothing of", () => {
    // A key that produced no frame is the interesting one — it is a keystroke
    // the desktop swallowed — so the round trip has to survive its own
    // stages being empty.
    const lines = diagnosticLines({ ...nothing, trip: sample(2, 9, 12) });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("round trip keys=2");
    expect(lines[0]).toContain("frames=0");
  });
});
