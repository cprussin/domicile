import { describe, expect, it } from "bun:test";

import { openingBox } from "./window-box";

describe("openingBox", () => {
  it("opens the first window at the top left, the size the client committed to", () => {
    expect(openingBox(0, [640, 480])).toStrictEqual({
      height: 480,
      left: 0,
      top: 0,
      width: 640,
    });
  });

  it("steps each window clear of the one before it", () => {
    // A client says how big it wants to be and nothing about where, so two
    // windows opened in a row would otherwise land exactly on top of each
    // other and look like one.
    const first = openingBox(0, [640, 480]);
    const second = openingBox(1, [640, 480]);
    expect(second.left).toBeGreaterThan(first.left);
    expect(second.top).toBeGreaterThan(first.top);
  });

  it("opens a window its client has not sized yet at a size it can be seen at", () => {
    // No size is what `app_appeared` carries before the client has committed,
    // which is every client at the moment it is announced. A window opened at
    // nothing is invisible for good.
    const box = openingBox(0, undefined);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("starts the cascade over rather than walking off the screen", () => {
    // Nothing closes a step in the cascade, so a session that opens windows
    // all day would put them past the bottom right corner and out of reach.
    expect(openingBox(8, [640, 480])).toStrictEqual(openingBox(0, [640, 480]));
  });
});
