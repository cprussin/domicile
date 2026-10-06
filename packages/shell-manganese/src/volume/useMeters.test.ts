import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { heldSound, laptop } from "./fixture";
import { useMeters } from "./useMeters";

describe("useMeters", () => {
  it("meters what can be metered of the ids, and stops when unmounted", () => {
    const sound = heldSound();
    const { unmount } = renderHook(() =>
      useMeters(sound.server, ["input:mic", "recording:7"], laptop.meters),
    );

    expect(sound.metered.at(-1)).toEqual(["input:mic"]);

    unmount();
    expect(sound.metered.at(-1)).toEqual([]);
  });

  it("meters again when what is shown changes", () => {
    const sound = heldSound();
    const { rerender } = renderHook(
      ({ ids }) => useMeters(sound.server, ids, laptop.meters),
      { initialProps: { ids: ["input:mic"] } },
    );

    rerender({ ids: ["input:mic", "output:hdmi"] });

    expect(sound.metered.at(-1)).toEqual(["input:mic", "output:hdmi"]);
  });

  it("reads each level in decibels, the bottom of the meter at -60", () => {
    const sound = heldSound();
    const { result } = renderHook(() =>
      useMeters(sound.server, ["input:mic"], laptop.meters),
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
