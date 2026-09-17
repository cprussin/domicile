import { describe, expect, it } from "bun:test";

import { placedAt } from "./window-styles";

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
