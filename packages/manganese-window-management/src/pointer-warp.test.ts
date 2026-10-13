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
    // The engine rounds warps (`base::ClampRound`). A fractional target would
    // never match the arrival, which would then read as a user move.
    const odd = { box: { height: 501, width: 401, x: 0, y: 0 }, id: "kitty" };

    expect(warpTo({ from: LEFT, pointer: [900, 900], to: odd })).toStrictEqual([
      201, 251,
    ]);
  });

  it("takes it there when the pointer has never been anywhere", () => {
    // The page has not seen the pointer yet, so it warps anyway.
    expect(
      warpTo({ from: undefined, pointer: undefined, to: LEFT }),
    ).toStrictEqual([200, 350]);
  });

  it("follows the window when the window is what moved", () => {
    // `mod+shift+l` moves the same window; the pointer is now over whatever
    // took its place.
    expect(
      warpTo({
        from: { ...LEFT, id: "kitty" },
        pointer: [200, 300],
        to: { box: RIGHT.box, id: "kitty" },
      }),
    ).toStrictEqual([600, 350]);
  });

  it("leaves the pointer alone when it is already over that window", () => {
    // Switching tabs keeps the same box, so there is nothing to warp to.
    expect(
      warpTo({
        from: LEFT,
        pointer: [200, 300],
        to: { box: LEFT.box, id: "emacs" },
      }),
    ).toBeUndefined();
  });

  it("leaves it alone when the keyboard did not move", () => {
    // Keys that do not move the focus, such as a split, leave the pointer.
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
