import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { heldBacklight } from "./held-backlight";
import { useBrightnessKeys } from "./useBrightnessKeys";

/** The keys on a backlight at `level`, with no bar showing it. */
const keysAt = (level: number) => {
  const held = heldBacklight();
  const { result } = renderHook(() => useBrightnessKeys(held.backlight));
  held.report(level);
  return { asked: held.asked, keys: result.current };
};

describe("useBrightnessKeys", () => {
  it("steps the brightness by 5%", () => {
    const { asked, keys } = keysAt(0.5);

    const levels = [keys.up(), keys.down()];

    expect(asked).toEqual([0.55, 0.45]);
    expect(levels).toEqual([0.55, 0.45]);
  });

  it("keeps the brightness between 0 and 100%", () => {
    const bright = keysAt(0.98);
    const dim = keysAt(0.02);

    bright.keys.up();
    dim.keys.down();

    expect([...bright.asked, ...dim.asked]).toEqual([1, 0]);
  });

  it("does nothing on a machine without a backlight", () => {
    const held = heldBacklight();
    const { result } = renderHook(() => useBrightnessKeys(held.backlight));

    const level = result.current.up();

    expect(held.asked).toEqual([]);
    expect(level).toBeUndefined();
  });
});
