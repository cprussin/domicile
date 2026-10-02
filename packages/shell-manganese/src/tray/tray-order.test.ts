import { describe, expect, it } from "bun:test";

import { arrange, moveTo, place } from "./tray-order";

const identity = (key: string) => key;

describe("arrange", () => {
  it("puts remembered items in their remembered order", () => {
    expect(arrange(["a", "b", "c"], identity, ["c", "a", "b"])).toStrictEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("puts items it has never placed after the rest, as they arrived", () => {
    // And a remembered one that is not here takes no place.
    expect(
      arrange(["new", "b", "a", "newer"], identity, ["x", "a", "b"]),
    ).toStrictEqual(["a", "b", "new", "newer"]);
  });
});

describe("place", () => {
  it("places shown items it had never placed after the rest, as they arrived", () => {
    // And one it placed that is not shown keeps its place.
    expect(place(["a", "gone"], ["new", "a", "newer"])).toStrictEqual([
      "a",
      "gone",
      "new",
      "newer",
    ]);
  });
});

describe("moveTo", () => {
  it("puts an item dragged rightward after the one it is over", () => {
    expect(moveTo(["a", "b", "c"], ["a", "b", "c"], "a", "b")).toStrictEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("puts an item dragged leftward before the one it is over", () => {
    expect(moveTo(["a", "b", "c"], ["a", "b", "c"], "c", "a")).toStrictEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps the place of an item that is not shown", () => {
    // `gone` was closed; it comes back between `a` and `b` whatever moved
    // around it meanwhile.
    expect(
      moveTo(["a", "gone", "b", "c"], ["a", "b", "c"], "c", "b"),
    ).toStrictEqual(["a", "gone", "c", "b"]);
  });

  it("places a shown item it had never placed before moving it", () => {
    expect(moveTo(["a"], ["a", "b", "c"], "c", "b")).toStrictEqual([
      "a",
      "c",
      "b",
    ]);
  });
});
