import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";

import { screenUnder } from "./screen-under";

const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};

const RIGHT: Display = {
  name: "right",
  position: [1920, 0],
  scale: 1,
  size: [1280, 1024],
};

describe("screenUnder", () => {
  it("names the display the pointer is on", () => {
    expect(screenUnder([LEFT, RIGHT], [2000, 500])).toBe("right");
  });

  it("puts a pointer on the seam on the screen that starts there", () => {
    // A rectangle is its left and top edges and not its right and bottom
    // ones, or the column the two screens share would be both of them.
    expect(screenUnder([LEFT, RIGHT], [1920, 0])).toBe("right");
  });

  it("names nothing for a pointer off every screen", () => {
    // Below the shorter monitor of the two, which a page that is the whole
    // desktop still has pixels in.
    expect(screenUnder([LEFT, RIGHT], [2000, 1050])).toBeUndefined();
  });
});
