import { describe, expect, it } from "bun:test";

import { Direction } from "../direction";
import { TITLE_BAR } from "../rect";
import type { Float } from "./float";
import {
  FLOAT_STEP,
  floatFor,
  grown,
  movedTo,
  rectOf,
  shifted,
  sizedTo,
} from "./float";

const AT: Float = {
  height: 420,
  id: "w1",
  scratchpad: false,
  width: 640,
  x: 100,
  y: 80,
};

describe("floatFor", () => {
  it("opens the first window in from the corner", () => {
    const first = floatFor("w1", 0);
    expect(first.x).toBeGreaterThan(0);
    expect(first.y).toBeGreaterThan(0);
  });

  it("cascades each window past the ones already out", () => {
    // Not on top of them: a window that opened exactly over the last one looks
    // like the last one moved, and there is nothing to grab to find out.
    const first = floatFor("w1", 0);
    const second = floatFor("w2", 1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("cascades by the count rather than by where the last one ended up", () => {
    // Dragging a window into the corner must not put the next one off the
    // screen, so the count is what says how many are already out.
    expect(floatFor("w3", 2)).toStrictEqual({
      ...floatFor("other", 2),
      id: "w3",
    });
  });

  it("opens every window at the same size", () => {
    const { height, width } = floatFor("w1", 0);
    expect(floatFor("w2", 5)).toMatchObject({ height, width });
  });
});

describe("movedTo", () => {
  it("puts the window where it was dragged", () => {
    expect(movedTo(AT, 300, 200)).toStrictEqual({ ...AT, x: 300, y: 200 });
  });

  it("keeps a window dragged off the top edge in reach", () => {
    // The top and the left are the two edges a window dragged past cannot be
    // dragged back from: the corner you would reach for is off the screen.
    expect(movedTo(AT, 300, -50).y).toBe(0);
  });

  it("keeps a window dragged off the left edge in reach", () => {
    expect(movedTo(AT, -120, 200).x).toBe(0);
  });

  it("lets a window go off the right and the bottom", () => {
    // Its top-left corner is still there to grab, so nothing is lost.
    const far = movedTo(AT, 99_999, 99_999);
    expect(far.x).toBe(99_999);
    expect(far.y).toBe(99_999);
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

  it("keeps the window in reach, the way a drag does", () => {
    expect(shifted({ ...AT, y: 0 }, Direction.Up).y).toBe(0);
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
