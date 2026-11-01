import { describe, expect, it } from "bun:test";

import { pageOf, stepOf } from "./list-walk";

const key = (name: string, ctrlKey = false) => ({ ctrlKey, key: name });

describe("stepOf", () => {
  it.each([
    [key("ArrowDown"), 1],
    [key("ArrowUp"), -1],
    [key("n", true), 1],
    [key("p", true), -1],
    [key("PageDown"), 10],
    [key("PageUp"), -10],
    [key("d", true), 5],
    [key("u", true), -5],
    [key("d"), undefined],
    [key("u"), undefined],
    [key("a", true), undefined],
  ])("moves %o by %p with a ten-row page", (pressed, step) => {
    expect(stepOf(pressed, 10)).toBe(step);
  });

  it("moves at least one row for half a one-row page", () => {
    expect(stepOf(key("d", true), 1)).toBe(1);
  });
});

describe("pageOf", () => {
  const scroller = (clientHeight: number, rowHeight: number | undefined) => ({
    clientHeight,
    querySelector: () =>
      rowHeight === undefined ? null : { offsetHeight: rowHeight },
  });

  it("holds the rows that fit whole", () => {
    expect(pageOf(scroller(400, 36))).toBe(11);
  });

  it("holds one row when no row is laid out", () => {
    expect(pageOf(scroller(400, 0))).toBe(1);
  });

  it("holds one row when the list is empty", () => {
    expect(pageOf(scroller(400, undefined))).toBe(1);
  });

  it("throws for a scroller that isn't mounted", () => {
    expect(() => pageOf(null)).toThrow("not mounted");
  });
});
