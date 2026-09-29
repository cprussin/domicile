import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { TITLE_BAR } from "../rect";
import { LayoutNode } from "../tree/node";
import type { Float } from "./float";
import {
  FLOAT_STEP,
  floatFor,
  grown,
  movedTo,
  rectOf,
  shifted,
  sizedTo,
  stretched,
} from "./float";

const AT: Float = {
  height: 420,
  root: LayoutNode.Window("w1"),
  scratchpad: false,
  width: 640,
  x: 100,
  y: 80,
};

describe("floatFor", () => {
  it("opens the first window in from the corner", () => {
    const first = floatFor(LayoutNode.Window("w1"), 0);
    expect(first.x).toBeGreaterThan(0);
    expect(first.y).toBeGreaterThan(0);
  });

  it("cascades each window past the ones already out", () => {
    // Not on top of them: a window that opened exactly over the last one looks
    // like the last one moved, and there is nothing to grab to find out.
    const first = floatFor(LayoutNode.Window("w1"), 0);
    const second = floatFor(LayoutNode.Window("w2"), 1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("cascades by the count rather than by where the last one ended up", () => {
    // Dragging a window into the corner must not put the next one off the
    // screen, so the count is what says how many are already out.
    expect(floatFor(LayoutNode.Window("w3"), 2)).toStrictEqual({
      ...floatFor(LayoutNode.Window("other"), 2),
      root: LayoutNode.Window("w3"),
    });
  });

  it("opens every window at the same size", () => {
    const { height, width } = floatFor(LayoutNode.Window("w1"), 0);
    expect(floatFor(LayoutNode.Window("w2"), 5)).toMatchObject({
      height,
      width,
    });
  });
});

describe("movedTo", () => {
  it("puts the window where it was dragged", () => {
    expect(movedTo(AT, 300, 200)).toStrictEqual({ ...AT, x: 300, y: 200 });
  });

  it("lets a window go off any edge", () => {
    expect(movedTo(AT, -120, -50)).toMatchObject({ x: -120, y: -50 });
    expect(movedTo(AT, 99_999, 99_999)).toMatchObject({
      x: 99_999,
      y: 99_999,
    });
  });

  it("leaves the window's size alone", () => {
    expect(movedTo(AT, 300, 200)).toMatchObject({
      height: AT.height,
      width: AT.width,
    });
  });
});

describe("sizedTo", () => {
  it("gives the window the size it was dragged to", () => {
    expect(sizedTo(AT, 800, 500)).toStrictEqual({
      ...AT,
      height: 500,
      width: 800,
    });
  });

  it("will not let a window be dragged narrower than its own grab", () => {
    // The corner a resize is driven from is inside the window, so a window
    // that can be made smaller than the grab can be made impossible to grab.
    expect(sizedTo(AT, 1, 500).width).toBeGreaterThan(1);
  });

  it("will not let a window be dragged shorter than its own title bar", () => {
    // The bar comes out of the height, so a window shorter than its bar would
    // have a surface of nothing and a frame with nothing left to grab.
    expect(sizedTo(AT, 800, 1).height).toBeGreaterThan(TITLE_BAR);
  });

  it("leaves the window where it is", () => {
    expect(sizedTo(AT, 800, 500)).toMatchObject({ x: AT.x, y: AT.y });
  });
});

describe("stretched", () => {
  const BOTTOM_RIGHT = {
    horizontal: Direction.Right,
    vertical: Direction.Down,
  };
  const TOP_LEFT = { horizontal: Direction.Left, vertical: Direction.Up };

  it("drags the bottom-right corner, leaving the window where it is", () => {
    expect(stretched(AT, BOTTOM_RIGHT, 30, 20)).toStrictEqual({
      ...AT,
      height: AT.height + 20,
      width: AT.width + 30,
    });
  });

  it("drags the top-left corner, leaving the bottom-right one where it is", () => {
    expect(stretched(AT, TOP_LEFT, 30, 20)).toStrictEqual({
      ...AT,
      height: AT.height - 20,
      width: AT.width - 30,
      x: AT.x + 30,
      y: AT.y + 20,
    });
  });

  it("holds the far edges still where the dragged ones have to stop", () => {
    // Too small on one axis and off the desktop on the other: either way the
    // edge not taken hold of must not be the one that gives.
    const squashed = stretched(AT, TOP_LEFT, AT.width, -AT.y - 50);
    expect(squashed.x + squashed.width).toBe(AT.x + AT.width);
    expect(squashed.width).toBeLessThan(AT.width);
    expect(squashed.y).toBe(0);
    expect(squashed.height).toBe(AT.y + AT.height);
  });

  it("drags one edge alone when the grip has no side on the other axis", () => {
    expect(
      stretched(
        AT,
        { horizontal: Direction.Left, vertical: undefined },
        30,
        20,
      ),
    ).toStrictEqual({ ...AT, width: AT.width - 30, x: AT.x + 30 });
  });
});

describe("rectOf", () => {
  it("is the whole frame, bar included", () => {
    expect(rectOf(AT)).toStrictEqual({
      height: AT.height,
      width: AT.width,
      x: AT.x,
      y: AT.y,
    });
  });
});

describe("shifted", () => {
  it("moves the window one step the way it was told", () => {
    expect(shifted(AT, Direction.Right)).toMatchObject({
      x: AT.x + FLOAT_STEP,
      y: AT.y,
    });
    expect(shifted(AT, Direction.Up)).toMatchObject({
      x: AT.x,
      y: AT.y - FLOAT_STEP,
    });
  });

  it("moves the window past the top and the left edges", () => {
    expect(shifted({ ...AT, y: 0 }, Direction.Up).y).toBe(-FLOAT_STEP);
  });
});

describe("grown", () => {
  it("grows the window along the axis it was told", () => {
    expect(grown(AT, Direction.Right)).toMatchObject({
      height: AT.height,
      width: AT.width + FLOAT_STEP,
    });
    expect(grown(AT, Direction.Down)).toMatchObject({
      height: AT.height + FLOAT_STEP,
      width: AT.width,
    });
  });

  it("shrinks it the other way about", () => {
    expect(grown(AT, Direction.Left).width).toBe(AT.width - FLOAT_STEP);
    expect(grown(AT, Direction.Up).height).toBe(AT.height - FLOAT_STEP);
  });

  it("will not shrink it below what is left to grab", () => {
    const smallest = grown({ ...AT, height: TITLE_BAR + 1 }, Direction.Up);

    expect(smallest.height).toBeGreaterThan(TITLE_BAR);
  });
});
