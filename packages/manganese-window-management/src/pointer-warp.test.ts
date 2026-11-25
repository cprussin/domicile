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
/** What the screen shows of both windows. */
const SHOWN = [LEFT, RIGHT].map(({ frame, id }) => ({ box: frame, id }));

describe("warpTo", () => {
  it("takes the pointer to the middle of the window the keyboard moved to", () => {
    expect(warpTo({ from: LEFT, shown: SHOWN, to: RIGHT })?.to).toStrictEqual([
      600, 350,
    ]);
  });

  it("leaves it over anywhere on that window, title bar included", () => {
    // The engine decides, since the page cannot see the pointer over a
    // browser window's page. Closing a group's last tab from its strip slides
    // the neighbor's strip under the pointer, which then stays put.
    expect(
      warpTo({ from: LEFT, shown: SHOWN, to: RIGHT })?.unlessOver,
    ).toStrictEqual(RIGHT.frame);
  });

  it("moves it only from over another window", () => {
    // Over the top bar or an empty screen, no other window would take focus
    // back, so a tab switch there leaves the pointer. The engine decides, for
    // the reason above.
    expect(
      warpTo({ from: LEFT, shown: SHOWN, to: RIGHT })?.onlyOver,
    ).toStrictEqual([LEFT.frame]);
  });

  it("leaves it alone when no other window is shown", () => {
    const shown = [{ box: RIGHT.frame, id: RIGHT.id }];

    expect(warpTo({ from: LEFT, shown, to: RIGHT })).toBeUndefined();
  });

  it("asks for a whole pixel, which is what the engine will give", () => {
    // The engine rounds warps (`base::ClampRound`). A fractional target would
    // never match the arrival, which would then read as a user move.
    const box = { height: 501, width: 401, x: 0, y: 0 };
    const odd = { box, frame: box, id: "kitty" };

    expect(warpTo({ from: LEFT, shown: SHOWN, to: odd })?.to).toStrictEqual([
      201, 251,
    ]);
  });

  it("follows the window when the window is what moved", () => {
    // `mod+shift+l` moves the same window; the pointer is now over whatever
    // took its place.
    expect(
      warpTo({ from: LEFT, shown: SHOWN, to: { ...RIGHT, id: "kitty" } })?.to,
    ).toStrictEqual([600, 350]);
  });

  it("leaves it alone when the keyboard did not move", () => {
    // Keys that do not move the focus, such as a split, leave the pointer.
    expect(warpTo({ from: LEFT, shown: SHOWN, to: LEFT })).toBeUndefined();
  });

  it("has nowhere to put it on an empty workspace", () => {
    expect(warpTo({ from: LEFT, shown: SHOWN, to: undefined })).toBeUndefined();
  });
});
