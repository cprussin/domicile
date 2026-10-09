import { describe, expect, it } from "bun:test";

import { appendEntries, groupByDay } from "./entries";
import type { Entry } from "./history-page";

const entry = (url: string, day: number, visits: number[]): Entry => ({
  day,
  id: `${day} ${url}`,
  time: Math.max(...visits),
  title: url,
  url,
  visits,
});

describe(appendEntries, () => {
  it("adds a later page's rows after the loaded ones", () => {
    expect(
      appendEntries([entry("a", 1, [30])], [entry("b", 1, [20])]).map(
        (row) => row.url,
      ),
    ).toEqual(["a", "b"]);
  });

  it("folds a page's older visits into its row for that day", () => {
    expect(
      appendEntries(
        [entry("a", 1, [30]), entry("b", 1, [25])],
        [entry("a", 1, [10, 20])],
      ),
    ).toEqual([entry("a", 1, [10, 20, 30]), entry("b", 1, [25])]);
  });
});

describe(groupByDay, () => {
  it("groups rows under their day, in order", () => {
    const [a, b, c] = [
      entry("a", 2, [30]),
      entry("b", 2, [20]),
      entry("c", 1, [5]),
    ];
    expect(groupByDay([a, b, c])).toEqual([
      { day: 2, entries: [a, b] },
      { day: 1, entries: [c] },
    ]);
  });
});
