import { describe, expect, it } from "bun:test";

import { Direction } from "../window-management/direction";
import { screenToward } from "./screen-toward";

// A laptop under the left half of a wide monitor, and a portrait monitor to the
// right of both.
const WIDE = { box: { height: 1080, width: 1920, x: 0, y: 0 }, name: "wide" };
const LAPTOP = {
  box: { height: 800, width: 1280, x: 0, y: 1080 },
  name: "laptop",
};
const TALL = {
  box: { height: 1920, width: 1080, x: 1920, y: 0 },
  name: "tall",
};
const DESK = [WIDE, LAPTOP, TALL];

describe("screenToward", () => {
  it("names the screen beside this one", () => {
    expect(screenToward(DESK, "wide", Direction.Right)).toBe("tall");
    expect(screenToward(DESK, "wide", Direction.Down)).toBe("laptop");
    expect(screenToward(DESK, "laptop", Direction.Up)).toBe("wide");
  });

  it("names nothing where no screen lies wholly that way", () => {
    expect(screenToward(DESK, "wide", Direction.Left)).toBeUndefined();
    expect(screenToward(DESK, "wide", Direction.Up)).toBeUndefined();
  });

  it("picks the nearest to this screen's middle of several that way", () => {
    // Both are to the right of the laptop; the portrait one is nearer its
    // middle.
    const far = {
      box: { height: 800, width: 1280, x: 1280, y: 5000 },
      name: "far",
    };
    expect(screenToward([...DESK, far], "laptop", Direction.Right)).toBe(
      "tall",
    );
  });

  it("throws for a screen the desk does not have", () => {
    expect(() => screenToward(DESK, "docked", Direction.Left)).toThrow();
  });
});
