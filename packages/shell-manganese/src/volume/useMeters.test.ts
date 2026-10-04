import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { heldSound } from "./fixture";
import { useMeters } from "./useMeters";

/** A short renewal, so a test can wait one out. */
const RENEW = 20;

describe("useMeters", () => {
  it("asks for the ids at once, renews the ask, and lets go", async () => {
    const sound = heldSound();
    const { unmount } = renderHook(() =>
      useMeters(sound.domicile, ["input:mic"], sound.watchLevels, RENEW),
    );

    expect(sound.metered).toEqual([["input:mic"]]);
    await new Promise((resolve) => setTimeout(resolve, RENEW * 2.5));
    expect(sound.metered.length).toBeGreaterThanOrEqual(2);

    unmount();
    expect(sound.metered.at(-1)).toEqual([]);
  });

  it("asks again when what is shown changes", () => {
    const sound = heldSound();
    const { rerender } = renderHook(
      ({ ids }) => useMeters(sound.domicile, ids, sound.watchLevels, RENEW),
      { initialProps: { ids: ["input:mic"] } },
    );

    rerender({ ids: ["input:mic", "output:hdmi"] });

    expect(sound.metered.at(-1)).toEqual(["input:mic", "output:hdmi"]);
  });

  it("reads each level in decibels, the bottom of the meter at -60", () => {
    const sound = heldSound();
    const { result } = renderHook(() =>
      useMeters(sound.domicile, ["input:mic"], sound.watchLevels, RENEW),
    );

    sound.levels(
      new Map([
        ["input:mic", 1],
        ["output:a", 0.001],
        ["output:b", 0.0316],
        ["output:c", 0],
      ]),
    );

    expect(result.current.get("input:mic")).toBe(1);
    expect(result.current.get("output:a")).toBe(0);
    expect(result.current.get("output:b")).toBeCloseTo(0.5, 2);
    expect(result.current.get("output:c")).toBe(0);
  });
});
