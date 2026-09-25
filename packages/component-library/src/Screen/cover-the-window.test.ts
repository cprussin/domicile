import { describe, expect, it } from "bun:test";

import { coverTheWindow } from "./cover-the-window";

/** The desk this exists for: a 4K panel at 1.2, stood on its side. */
const MODE = [3840, 2160] as const;
const BOX = [1800, 3200] as const;

describe("coverTheWindow", () => {
  it("is nothing at all for a region that is not a window", () => {
    // Every desktop the page's window is the whole of: a nested run, a
    // developer window, a shell open in a plain browser. The page's CSS pixels
    // already are the desktop's logical ones, the region is placed by its
    // `left`/`top`, and a transform here would be an identity to compute on
    // every render and a stacking context to explain forever after.
    expect(coverTheWindow(BOX, undefined)).toBeUndefined();
  });

  it("scales a region onto a window of more pixels than it lays out in", () => {
    // The mixed-density half, which has nothing to do with rotation and was
    // broken on its own. A 3840-wide panel at 1.2 is a 3200-wide box, and the
    // window is the mode — so a region drawn at its logical size is a picture
    // in the corner of a black screen.
    expect(
      coverTheWindow([3200, 1800], {
        size: [3840, 2160],
        transform: "normal",
      }),
    ).toBe("scale(1.2)");
  });

  it("leaves a region that already fits alone but for the identity", () => {
    // A monitor at density 1 filling its own window. The scale is 1 and the
    // turn is none, and the answer is still a transform rather than nothing:
    // `undefined` means "not a window", and a window that needs no mapping is
    // a different thing from a region that is not one.
    expect(
      coverTheWindow([1920, 1080], {
        size: [1920, 1080],
        transform: "normal",
      }),
    ).toBe("scale(1)");
  });

  it("turns a region a quarter clockwise and pushes it back into view", () => {
    // The quarter turn this desk actually uses: kanshi says `transform =
    // "270"` for the three monitors on their sides, and the domicile config
    // says `rotate-270` for the same three. `wl_output`'s `transform_270` is a
    // panel whose content is turned a quarter CLOCKWISE to come out upright,
    // which takes the box's top-left corner to the window's top-RIGHT — so
    // every pixel of it lands at a negative x until it is pushed back by the
    // window's width.
    //
    // The scale comes first (transforms apply right to left), so what is
    // turned is the box at its full 2160×3840 rather than its logical size.
    expect(coverTheWindow(BOX, { size: MODE, transform: "rotate-270" })).toBe(
      "translate(3840px, 0) rotate(90deg) scale(1.2)",
    );
  });

  it("turns a region a quarter counterclockwise and pushes it back into view", () => {
    // `rotate-90`, the other quarter turn. Counterclockwise takes the top-left
    // corner to the window's bottom-left, so the push is down by the window's
    // height rather than right by its width.
    expect(coverTheWindow(BOX, { size: MODE, transform: "rotate-90" })).toBe(
      "translate(0, 2160px) rotate(-90deg) scale(1.2)",
    );
  });

  it("turns a region over and pushes it back by both", () => {
    // A half turn swaps no axes, so the box divides into the mode the way it
    // does lying down — and both corners move, so both pushes are needed.
    expect(
      coverTheWindow([3200, 1800], {
        size: [3840, 2160],
        transform: "rotate-180",
      }),
    ).toBe("translate(3840px, 2160px) rotate(180deg) scale(1.2)");
  });

  it("measures the scale across the turn rather than along it", () => {
    // THE MISTAKE THIS IS HERE TO CATCH. A quarter turn trades the monitor's
    // width for its height, so the box's width is what the mode's HEIGHT
    // divides by. Measuring 3840 against 1800 gives 2.13 — a desktop drawn
    // nearly twice too large, off three edges of the screen, on a monitor
    // that is otherwise working.
    //
    // A mode and a box that are not a whole ratio apart, so a scale taken
    // from the wrong axis cannot come out right by accident: 2160/1800 is
    // 1.2 and 3840/1800 is not.
    expect(
      coverTheWindow(BOX, { size: MODE, transform: "rotate-270" }),
    ).toContain("scale(1.2)");
  });

  it("is nothing for a window with no pixels", () => {
    // `[0, 0]` is what a host that has nothing to say about modes sends, and
    // a region scaled by zero is a region nobody can see. It should not be
    // reachable — a display with no mode is one nothing claimed was a window —
    // but the two facts arrive separately and this is the seam between them.
    expect(
      coverTheWindow(BOX, { size: [0, 0], transform: "normal" }),
    ).toBeUndefined();
  });

  it("is nothing for a region with no area", () => {
    // The other side of the same division. A zero-sized display is refused by
    // the config and by the schema; this is the arithmetic refusing to divide
    // by it rather than trusting that they both held.
    expect(
      coverTheWindow([0, 0], { size: MODE, transform: "normal" }),
    ).toBeUndefined();
  });
});
