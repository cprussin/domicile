import { describe, expect, it } from "bun:test";

import { placementLine } from "./placement-line";

const sample = (count: number, averageMs: number, worstMs: number) => ({
  averageMs,
  count,
  worstMs,
});

describe("placementLine", () => {
  it("says nothing about a desktop that measured nothing", () => {
    // The log is read by a person watching for a number that changed. A line
    // of zeroes every interval is what stops anyone reading it.
    expect(placementLine(undefined)).toBeUndefined();
  });

  it("reports what windows cost when nobody is touching the machine", () => {
    // The case this measurement exists for: a desktop sitting there, paying
    // for every window on every frame.
    expect(placementLine(sample(1180, 0.4, 2))).toContain("placements=1180");
  });

  it("reports a cost too small to print in whole milliseconds", () => {
    // One measurement is sub-millisecond by construction, so whole
    // milliseconds print every one of them as zero — and the reader, told to
    // multiply a count by an average, gets nothing. These are the numbers that
    // say a desktop spends most of half a second per five on measuring windows
    // nobody is looking at, which is the answer this line exists to give.
    expect(placementLine(sample(1180, 0.4, 0.1))).toBe(
      "placements=1180 place_total_ms=472 place_ms=0.40 place_worst_ms=0.10",
    );
  });
});
