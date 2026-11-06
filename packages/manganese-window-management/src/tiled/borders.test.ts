import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { bordersOf } from "./borders";

describe("bordersOf", () => {
  it("covers the gap between two windows, half to each, and a little of each window", () => {
    const left = { frame: { height: 400, width: 490, x: 0, y: 0 }, id: "a" };
    const right = { frame: { height: 400, width: 490, x: 510, y: 0 }, id: "b" };
    expect(bordersOf([left, right])).toEqual([
      {
        edge: Direction.Right,
        id: "a",
        rect: { height: 400, width: 14, x: 486, y: 0 },
      },
      {
        edge: Direction.Left,
        id: "b",
        rect: { height: 400, width: 14, x: 500, y: 0 },
      },
    ]);
  });

  it("gives every side that faces another window one, and no side that faces the workspace's edge", () => {
    const tall = { frame: { height: 800, width: 490, x: 0, y: 0 }, id: "a" };
    const top = { frame: { height: 390, width: 490, x: 510, y: 0 }, id: "b" };
    const bottom = {
      frame: { height: 390, width: 490, x: 510, y: 410 },
      id: "c",
    };
    expect(
      bordersOf([tall, top, bottom]).map(({ edge, id }) => ({ edge, id })),
    ).toEqual([
      { edge: Direction.Right, id: "a" },
      { edge: Direction.Left, id: "b" },
      { edge: Direction.Down, id: "b" },
      { edge: Direction.Left, id: "c" },
      { edge: Direction.Up, id: "c" },
    ]);
  });

  // A window in a group nested in a tab sits under the outer strip, whose tabs
  // a border must not cover.
  it("reaches no further than half the gap between tiled windows", () => {
    const above = { frame: { height: 400, width: 1000, x: 0, y: 0 }, id: "a" };
    const nested = {
      frame: { height: 300, width: 980, x: 10, y: 470 },
      id: "b",
    };
    expect(bordersOf([above, nested]).map(({ rect }) => rect)).toEqual([
      { height: 14, width: 1000, x: 0, y: 396 },
      { height: 14, width: 980, x: 10, y: 460 },
    ]);
  });

  it("has none for a window alone", () => {
    expect(
      bordersOf([{ frame: { height: 400, width: 500, x: 0, y: 0 }, id: "a" }]),
    ).toEqual([]);
  });
});
