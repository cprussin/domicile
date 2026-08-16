import { describe, it, expect } from "vitest";
import { evdevFromCode, buttonCodeFromJs, surfaceLocal } from "../src/input.js";

describe("evdevFromCode", () => {
  it("maps common keys to evdev codes", () => {
    expect(evdevFromCode("KeyA")).toBe(30);
    expect(evdevFromCode("Enter")).toBe(28);
    expect(evdevFromCode("Space")).toBe(57);
    expect(evdevFromCode("Digit1")).toBe(2);
    expect(evdevFromCode("ArrowUp")).toBe(103);
  });
  it("returns null for unmapped codes", () => {
    expect(evdevFromCode("MediaPlayPause")).toBeNull();
  });
});

describe("buttonCodeFromJs", () => {
  it("maps mouse buttons to Linux codes", () => {
    expect(buttonCodeFromJs(0)).toBe(0x110);
    expect(buttonCodeFromJs(2)).toBe(0x111);
    expect(buttonCodeFromJs(1)).toBe(0x112);
    expect(buttonCodeFromJs(9)).toBeNull();
  });
});

describe("surfaceLocal", () => {
  it("scales element-box coords to surface pixels", () => {
    // element box is 200x200 on screen; surface is 100x100.
    const rect = { left: 10, top: 20, width: 200, height: 200 };
    expect(surfaceLocal(rect, 110, 120, 100, 100)).toEqual({ x: 50, y: 50 });
  });
  it("falls back to element size when surface size is unknown", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(surfaceLocal(rect, 25, 40, 0, 0)).toEqual({ x: 25, y: 40 });
  });
  it("returns null without a layout box", () => {
    expect(surfaceLocal({ left: 0, top: 0, width: 0, height: 0 }, 5, 5, 10, 10)).toBeNull();
  });
});
