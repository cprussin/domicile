import { describe, expect, it } from "bun:test";

import { placedAt, scaledAbout } from "./window-styles";

const RECT = { height: 200, width: 300, x: 10, y: 20 };

describe("placedAt", () => {
  it("places a window in the desktop's own coordinates", () => {
    // `fixed`, not `absolute`. The page spans the whole desktop, so the
    // viewport *is* the desktop: a window at 0 is at the desktop's own
    // corner, over the top bar, which is where a fullscreen window goes and
    // where a floating one is allowed to be dragged.
    expect(placedAt(RECT, 0).position).toBe("fixed");
  });

  it("puts the window where the rectangle says", () => {
    expect(placedAt(RECT, 0)).toMatchObject({
      blockSize: "200px",
      inlineSize: "300px",
      insetBlockStart: "20px",
      insetInlineStart: "10px",
    });
  });

  it("writes the depth as the element's own z-index", () => {
    // Which is what the compositor stacks the client's surface by, so it has
    // to be on the element rather than on anything wrapping it.
    expect(placedAt(RECT, 3).zIndex).toBe(3);
  });
});

// The two halves of one window, and the box they span together.
const FRAME = { height: 1048, width: 1920, x: 0, y: 32 };
const BAR = { height: 30, width: 1920, x: 0, y: 32 };
const SURFACE = { height: 1018, width: 1920, x: 0, y: 62 };

describe("scaledAbout", () => {
  // A WINDOW TURNS ABOUT ONE POINT, NOT TWO. Its bar and its contents are
  // separate elements: scaled about their own centers they would pull apart
  // by a fraction of the window's height, and a frame in two pieces is not a
  // window arriving.
  it("turns the contents about the middle of the whole frame", () => {
    // The frame's middle is (960, 556) on the desktop, which is 494 down from
    // the top of the contents.
    expect(scaledAbout(FRAME, SURFACE).transformOrigin).toBe("960px 494px");
  });

  it("turns the bar about that same point, which is below the bar", () => {
    expect(scaledAbout(FRAME, BAR).transformOrigin).toBe("960px 524px");
  });

  it("turns a box that is the whole frame about its own middle", () => {
    // A window a tab is hiding has nothing but its tab on screen, so the tab
    // is the frame and the shared point is the ordinary one.
    expect(scaledAbout(BAR, BAR).transformOrigin).toBe("960px 15px");
  });
});
