import { describe, expect, it } from "bun:test";

import { shapeClipPath } from "./app-window-shape";

describe("shapeClipPath", () => {
  it("draws the page within each of its app's boxes", () => {
    expect(
      shapeClipPath(
        JSON.stringify([
          { height: 40, width: 30, x: 1, y: 2 },
          { height: 8, width: 7, x: -5, y: 60 },
        ]),
      ),
    ).toBe('path("M1 2h30v40h-30ZM-5 60h7v8h-7Z")');
  });

  it("throws on a shape the engine would never list", () => {
    expect(() => shapeClipPath('[{"x":1}]')).toThrow();
    // The engine lists no shape for Electron's empty one, the whole window.
    expect(() => shapeClipPath("[]")).toThrow();
  });
});
