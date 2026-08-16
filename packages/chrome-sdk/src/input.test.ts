import { describe, expect, it } from "bun:test";

import {
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  buttonCodeFromJs,
  evdevFromCode,
  surfaceLocal,
} from "./input";

describe("evdevFromCode", () => {
  it("maps common keys to evdev codes", () => {
    expect(evdevFromCode("KeyA")).toBe(30);
    expect(evdevFromCode("Enter")).toBe(28);
    expect(evdevFromCode("Space")).toBe(57);
    expect(evdevFromCode("Digit1")).toBe(2);
    expect(evdevFromCode("ArrowUp")).toBe(103);
  });

  it("returns undefined for unmapped codes", () => {
    expect(evdevFromCode("MediaPlayPause")).toBeUndefined();
  });
});

describe("buttonCodeFromJs", () => {
  it("maps mouse buttons to Linux codes", () => {
    expect(buttonCodeFromJs(0)).toBe(BTN_LEFT);
    expect(buttonCodeFromJs(2)).toBe(BTN_RIGHT);
    expect(buttonCodeFromJs(1)).toBe(BTN_MIDDLE);
    expect(buttonCodeFromJs(9)).toBeUndefined();
  });
});

describe("surfaceLocal", () => {
  it("scales element-box coords to surface pixels", () => {
    // element box is 200x200 on screen; surface is 100x100.
    const box = { height: 200, left: 10, top: 20, width: 200 };
    expect(surfaceLocal(box, 110, 120, 100, 100)).toEqual({ x: 50, y: 50 });
  });

  it("falls back to element size when surface size is unknown", () => {
    const box = { height: 100, left: 0, top: 0, width: 100 };
    expect(surfaceLocal(box, 25, 40, 0, 0)).toEqual({ x: 25, y: 40 });
  });

  it("returns undefined without a layout box", () => {
    const box = { height: 0, left: 0, top: 0, width: 0 };
    expect(surfaceLocal(box, 5, 5, 10, 10)).toBeUndefined();
  });
});
