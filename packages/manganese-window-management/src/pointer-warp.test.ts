import { describe, expect, it } from "bun:test";

import { warpTo } from "./pointer-warp";

// Each window's title bar is the 30 pixels above its contents.
const LEFT = {
  box: { height: 500, width: 400, x: 0, y: 100 },
  frame: { height: 530, width: 400, x: 0, y: 70 },
  id: "kitty",
};
const RIGHT = {
  box: { height: 500, width: 400, x: 400, y: 100 },
  frame: { height: 530, width: 400, x: 400, y: 70 },
  id: "emacs",
};

describe("warpTo", () => {
  it("takes the pointer to the middle of the window the keyboard moved to", () => {
    expect(
      warpTo({ from: LEFT, pointer: [200, 300], to: RIGHT }),
    ).toStrictEqual([600, 350]);
  });

  it("asks for a whole pixel, which is what the engine will give", () => {
    // The engine rounds warps (`base::ClampRound`). A fractional target would
    // never match the arrival, which would then read as a user move.
    const box = { height: 501, width: 401, x: 0, y: 0 };
    const odd = { box, frame: box, id: "kitty" };

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
        from: LEFT,
        pointer: [200, 300],
        to: { ...RIGHT, id: "kitty" },
      }),
    ).toStrictEqual([600, 350]);
  });

  it("leaves the pointer alone when it is already over that window", () => {
    // Switching tabs keeps the same box, so there is nothing to warp to.
    expect(
      warpTo({
        from: LEFT,
        pointer: [200, 300],
        to: { ...LEFT, id: "emacs" },
      }),
    ).toBeUndefined();
  });

  it("leaves it alone over that window's title bar", () => {
    // Closing a group's last tab from its strip slides the neighbor's strip
    // under the pointer. The pointer is already on the window it focuses.
    expect(
      warpTo({ from: LEFT, pointer: [600, 80], to: RIGHT }),
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
