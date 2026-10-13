import { describe, expect, it } from "bun:test";

import { sharedWith } from "./structural-sharing";

describe("sharedWith", () => {
  it("returns the previous value when the next one equals it", () => {
    const previous = { list: [{ x: 1 }], name: "a" };

    expect(sharedWith(previous, { list: [{ x: 1 }], name: "a" })).toBe(
      previous,
    );
  });

  it("keeps the unchanged parts of a changed value", () => {
    const previous = [{ x: 1 }, { x: 2 }];

    const next = sharedWith(previous, [{ x: 1 }, { x: 3 }]);

    expect(next).toEqual([{ x: 1 }, { x: 3 }]);
    expect(next[0]).toBe(previous[0]);
  });
});
