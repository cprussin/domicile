import { describe, expect, it } from "bun:test";

import type { Float } from "./float";
import {
  barBox,
  floatFor,
  frameBox,
  movedTo,
  sizedTo,
  surfaceBox,
  TITLE_BAR,
} from "./float";

const AT: Float = { height: 420, id: "w1", width: 640, x: 100, y: 80 };

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
    // stage, so the count is what says how many are already out.
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

describe("the parts of a floating window", () => {
  it("gives the frame the whole box", () => {
    expect(frameBox(AT)).toStrictEqual({
      height: AT.height,
      width: AT.width,
      x: AT.x,
      y: AT.y,
    });
  });

  it("puts the bar along the top of the frame", () => {
    expect(barBox(AT)).toStrictEqual({
      height: TITLE_BAR,
      width: AT.width,
      x: AT.x,
      y: AT.y,
    });
  });

  it("puts the surface under the bar", () => {
    expect(surfaceBox(AT)).toStrictEqual({
      height: AT.height - TITLE_BAR,
      width: AT.width,
      x: AT.x,
      y: AT.y + TITLE_BAR,
    });
  });

  it("takes the bar out of the window rather than adding it on", () => {
    // A float's box is the whole frame, so a window dragged to a size is that
    // size, bar included, and a resize needs no frame that grows with it.
    const parts = barBox(AT).height + surfaceBox(AT).height;
    expect(parts).toBe(frameBox(AT).height);
  });

  it("never gives the surface a negative height", () => {
    // `sizedTo` keeps a window taller than its own bar, so this holds — but a
    // negative height reaches the compositor as a window turned inside out.
    const squashed: Float = { ...AT, height: 1 };
    expect(surfaceBox(squashed).height).toBe(0);
  });
});
