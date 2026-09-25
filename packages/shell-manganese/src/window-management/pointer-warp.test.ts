import { describe, expect, it } from "bun:test";

import { warpTo } from "./pointer-warp";

const LEFT = { box: { height: 500, width: 400, x: 0, y: 100 }, id: "kitty" };
const RIGHT = { box: { height: 500, width: 400, x: 400, y: 100 }, id: "emacs" };

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
