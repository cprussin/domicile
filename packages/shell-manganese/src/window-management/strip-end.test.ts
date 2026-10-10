import { describe, expect, it } from "bun:test";

import { stripEndOf } from "./strip-end";
import type { StripPlace } from "./tree/frames";

const TAB = { height: 30, width: 240, x: 240, y: 0 };

/** The second of two tabs, the last in a tabbed strip 1000 wide. */
const LAST: StripPlace = {
  at: 1,
  box: { height: 30, width: 1000, x: 0, y: 0 },
  divided: false,
  first: false,
  group: { node: { id: "a", up: 1 }, windows: ["a", "b"] },
  open: false,
  rest: 520,
  tabs: 2,
};

describe("stripEndOf", () => {
  it("is the strip past a tabbed strip's last tab", () => {
    expect(stripEndOf(TAB, LAST)).toEqual({
      height: 30,
      width: 520,
      x: 480,
      y: 0,
    });
  });

  it("is nothing past any other tab", () => {
    expect(stripEndOf(TAB, { ...LAST, at: 0 })).toBeUndefined();
  });

  it("is nothing for a stack, whose bars span its strip", () => {
    expect(stripEndOf(TAB, { ...LAST, rest: undefined })).toBeUndefined();
  });

  it("is nothing for a window's own bar", () => {
    expect(stripEndOf(TAB, undefined)).toBeUndefined();
  });
});
