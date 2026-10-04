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
  retiled,
  shifted,
  sizedTo,
  stretched,
} from "./float";

const AT: Float = {
  depth: 0,
  height: 420,
  root: LayoutNode.Window("w1"),
  scratchpad: false,
  width: 640,
  x: 100,
  y: 80,
};

/** A 1920 by 1080 screen, large enough for a float at its own size. */
const SCREEN = { height: 1080, width: 1920 };

describe("floatFor", () => {
  it("opens the first window in from the corner", () => {
    const first = floatFor(LayoutNode.Window("w1"), 0, SCREEN);
    expect(first.x).toBeGreaterThan(0);
    expect(first.y).toBeGreaterThan(0);
  });

  it("cascades each window past the ones already out", () => {
    // A window opened exactly over the last would look like the last one
    // moved.
    const first = floatFor(LayoutNode.Window("w1"), 0, SCREEN);
    const second = floatFor(LayoutNode.Window("w2"), 1, SCREEN);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("cascades by the count rather than by where the last one ended up", () => {
    // So a window dragged into the corner does not push the next one off
    // screen.
    expect(floatFor(LayoutNode.Window("w3"), 2, SCREEN)).toStrictEqual({
      ...floatFor(LayoutNode.Window("other"), 2, SCREEN),
      root: LayoutNode.Window("w3"),
    });
  });

  it("opens every window at the same size", () => {
    const { height, width } = floatFor(LayoutNode.Window("w1"), 0, SCREEN);
    expect(floatFor(LayoutNode.Window("w2"), 5, SCREEN)).toMatchObject({
      height,
      width,
    });
  });

  it("opens big enough to work in on a screen with room for it", () => {
    expect(floatFor(LayoutNode.Window("w1"), 0, SCREEN)).toMatchObject({
      height: 800,
      width: 1280,
    });
  });

  it("never opens bigger than the screen it is on", () => {
    const screen = { height: 768, width: 1024 };
    const { height, width, x, y } = floatFor(
      LayoutNode.Window("w1"),
      0,
      screen,
    );
    expect(x + width).toBeLessThanOrEqual(screen.width);
    expect(y + height).toBeLessThanOrEqual(screen.height);
  });
});

describe("retiled", () => {
  it("is the same box when its tree did not change", () => {
    expect(retiled(AT, (tiling) => ({ ...tiling }))).toBe(AT);
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
    // The resize corner is inside the window, so a smaller window could not
    // be grabbed.
    expect(sizedTo(AT, 1, 500).width).toBeGreaterThan(1);
  });

  it("will not let a window be dragged shorter than its own title bar", () => {
    // The bar is part of the height, so a shorter window would have no
    // surface.
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
    // Whether clamped by minimum size or by the desktop edge, the opposite
    // edge stays put.
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
