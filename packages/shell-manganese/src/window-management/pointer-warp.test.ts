import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile/component-library/display-source";

import { pageBoxOf, warpTo } from "./pointer-warp";

const LEFT = { box: { height: 500, width: 400, x: 0, y: 100 }, id: "kitty" };
const RIGHT = { box: { height: 500, width: 400, x: 400, y: 100 }, id: "emacs" };

/** A window somewhere on the desktop, in the coordinates it is laid out in. */
const WINDOW = { height: 100, width: 200, x: 100, y: 50 };

const panel = (
  size: readonly [number, number],
  scanout: Display["scanout"],
): Display => ({ name: "panel", position: [0, 0], scale: 2, scanout, size });

describe("pageBoxOf", () => {
  it("is the box it was given where the page is the whole desktop", () => {
    // A nested run, a developer window, a shell in a plain browser: the page's
    // coordinates already are the desktop's, and the pointer is spoken about
    // in them.
    expect(pageBoxOf(WINDOW, panel([960, 540], undefined))).toStrictEqual(
      WINDOW,
    );
  });

  it("scales a box onto the window its region covers", () => {
    // THE BUG THIS EXISTS FOR. A 1920-pixel panel laid out as 960 logical ones
    // draws every window at twice the number it was placed at, so a pointer
    // sent to the layout's own number lands at half the distance in — right at
    // the corner, and further out the further from it.
    expect(
      pageBoxOf(
        WINDOW,
        panel([960, 540], { size: [1920, 1080], transform: "normal" }),
      ),
    ).toStrictEqual({ height: 200, width: 400, x: 200, y: 100 });
  });

  it("carries a box around with a monitor on its side", () => {
    // The turn swaps the axes, so a box stays a box and stops being the same
    // box: what was 200 across and 100 down is 200 down and 400 across, and
    // the corner it is measured from is the other one.
    expect(
      pageBoxOf(
        WINDOW,
        panel([540, 960], { size: [1920, 1080], transform: "rotate-270" }),
      ),
    ).toStrictEqual({ height: 400, width: 200, x: 100, y: 480 });
  });
});

describe("warpTo", () => {
  it("takes the pointer to the middle of the window the keyboard moved to", () => {
    expect(
      warpTo({ from: LEFT, pointer: [200, 300], to: RIGHT }),
    ).toStrictEqual([600, 350]);
  });

  it("asks for a whole pixel, which is what the engine will give", () => {
    // The engine rounds what it is asked for — `PointerWarpTarget` pins the
    // spot with `base::ClampRound` — and the page hears back the pixel it
    // landed on. A fraction asked for is a fraction the arrival never
    // matches, and an arrival that matches nothing is read as the user
    // having pointed at whatever the cursor came down on.
    const odd = { box: { height: 501, width: 401, x: 0, y: 0 }, id: "kitty" };

    expect(warpTo({ from: LEFT, pointer: [900, 900], to: odd })).toStrictEqual([
      201, 251,
    ]);
  });

  it("takes it there when the pointer has never been anywhere", () => {
    // A desktop nobody has touched the trackpad on yet. The pointer is still
    // somewhere — the engine draws it at the middle of the screen — and this
    // page has not been told where, which is not a reason to leave the focus
    // able to hand itself back.
    expect(
      warpTo({ from: undefined, pointer: undefined, to: LEFT }),
    ).toStrictEqual([200, 350]);
  });

  it("follows the window when the window is what moved", () => {
    // `mod+shift+l`: the same window, somewhere else. The pointer is over
    // whatever slid into the space it left, which is the window that would
    // take the focus back.
    expect(
      warpTo({
        from: { ...LEFT, id: "kitty" },
        pointer: [200, 300],
        to: { box: RIGHT.box, id: "kitty" },
      }),
    ).toStrictEqual([600, 350]);
  });

  it("leaves the pointer alone when it is already over that window", () => {
    // A tab of the container the pointer is over: the box is the same box, so
    // there is nothing to move to and nothing that can take the focus back.
    expect(
      warpTo({
        from: LEFT,
        pointer: [200, 300],
        to: { box: LEFT.box, id: "emacs" },
      }),
    ).toBeUndefined();
  });

  it("leaves it alone when the keyboard did not move", () => {
    // Every other key: a layout change, a split, the launcher. The pointer is
    // where the user put it and nothing has come between it and the focus.
    expect(
      warpTo({ from: LEFT, pointer: [900, 900], to: LEFT }),
    ).toBeUndefined();
  });

  it("has nowhere to put it on an empty workspace", () => {
    expect(
      warpTo({ from: LEFT, pointer: [200, 300], to: undefined }),
    ).toBeUndefined();
  });
});
