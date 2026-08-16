import { describe, expect, it } from "bun:test";

import {
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  buttonCodeFromJs,
  evdevFromCode,
} from "./input";

describe("evdevFromCode", () => {
  it("maps common keys to evdev codes", () => {
    expect(evdevFromCode("KeyA")).toBe(30);
    expect(evdevFromCode("Enter")).toBe(28);
    expect(evdevFromCode("Space")).toBe(57);
    expect(evdevFromCode("Digit1")).toBe(2);
    expect(evdevFromCode("ArrowUp")).toBe(103);
  });

  it("maps the numpad", () => {
    expect(evdevFromCode("Numpad0")).toBe(82);
    expect(evdevFromCode("Numpad7")).toBe(71);
    expect(evdevFromCode("NumpadDivide")).toBe(98);
    expect(evdevFromCode("NumpadSubtract")).toBe(74);
    expect(evdevFromCode("NumpadAdd")).toBe(78);
    expect(evdevFromCode("NumpadEnter")).toBe(96);
    expect(evdevFromCode("NumpadDecimal")).toBe(83);
  });

  it("maps media and browser keys", () => {
    expect(evdevFromCode("AudioVolumeMute")).toBe(113);
    expect(evdevFromCode("MediaPlayPause")).toBe(164);
    expect(evdevFromCode("MediaTrackNext")).toBe(163);
    expect(evdevFromCode("BrowserBack")).toBe(158);
    expect(evdevFromCode("BrowserSearch")).toBe(217);
  });

  it("maps the international and IME keys", () => {
    expect(evdevFromCode("IntlBackslash")).toBe(86);
    expect(evdevFromCode("IntlRo")).toBe(89);
    expect(evdevFromCode("IntlYen")).toBe(124);
    expect(evdevFromCode("Convert")).toBe(92);
    expect(evdevFromCode("NonConvert")).toBe(94);
    expect(evdevFromCode("KanaMode")).toBe(93);
    expect(evdevFromCode("Lang1")).toBe(122);
  });

  it("maps the extended function keys and system keys", () => {
    expect(evdevFromCode("F13")).toBe(183);
    expect(evdevFromCode("F24")).toBe(194);
    expect(evdevFromCode("PrintScreen")).toBe(99);
    expect(evdevFromCode("Pause")).toBe(119);
  });

  it("returns undefined for codes with no evdev equivalent", () => {
    expect(evdevFromCode("Abort")).toBeUndefined();
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
