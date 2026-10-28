import { describe, expect, it } from "bun:test";

import { speedOf } from "./speed";

describe(speedOf, () => {
  it.each([
    [866.7, "867 Mb/s"],
    [100, "100 Mb/s"],
    [1000, "1 Gb/s"],
    [2402, "2.4 Gb/s"],
  ])("reads %d Mb/s as %s", (mbps, shown) => {
    expect(speedOf(mbps)).toBe(shown);
  });
});
