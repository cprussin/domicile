import { describe, expect, it } from "bun:test";

import { toggleSelection } from "./selection";

const ORDER = ["a", "b", "c", "d"];

describe(toggleSelection, () => {
  it("toggles one row", () => {
    expect(toggleSelection(new Set(["a"]), ORDER, { id: "b" })).toEqual(
      new Set(["a", "b"]),
    );
    expect(toggleSelection(new Set(["a"]), ORDER, { id: "a" })).toEqual(
      new Set(),
    );
  });

  it("sets every row from the anchor to the target as the target turns", () => {
    expect(
      toggleSelection(new Set(["b"]), ORDER, { anchor: "b", id: "d" }),
    ).toEqual(new Set(["b", "c", "d"]));
    expect(
      toggleSelection(new Set(["a", "b", "c", "d"]), ORDER, {
        anchor: "d",
        id: "b",
      }),
    ).toEqual(new Set(["a"]));
  });

  it("toggles one row when the anchor is gone", () => {
    expect(toggleSelection(new Set(), ORDER, { anchor: "x", id: "c" })).toEqual(
      new Set(["c"]),
    );
  });
});
