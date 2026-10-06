import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import type { PlacedFocusBox } from "./placement";
import { useFocusGlows } from "./useFocusGlows";

const LEFT: PlacedFocusBox = {
  depth: 0,
  rect: { height: 1008, width: 930, x: 20, y: 52 },
  windows: ["app:term"],
};

const RIGHT: PlacedFocusBox = {
  depth: 0,
  rect: { height: 1008, width: 930, x: 970, y: 52 },
  windows: ["app:editor"],
};

const glowsFor = (first: PlacedFocusBox | undefined) =>
  renderHook(({ box }) => useFocusGlows(box), { initialProps: { box: first } });

describe("useFocusGlows", () => {
  it("lights the focus box", () => {
    const { result } = glowsFor(LEFT);

    expect(result.current).toEqual([{ box: LEFT, leaving: false }]);
  });

  it("keeps the box focus left, fading out, beside the one it moved to", () => {
    const { rerender, result } = glowsFor(LEFT);

    rerender({ box: RIGHT });

    expect(result.current).toEqual([
      { box: LEFT, leaving: true },
      { box: RIGHT, leaving: false },
    ]);
  });

  it("moves a box with its windows, and fades it out where it last was", () => {
    const { rerender, result } = glowsFor(LEFT);
    const narrower = { ...LEFT, rect: { ...LEFT.rect, width: 600 } };

    rerender({ box: narrower });
    expect(result.current).toEqual([{ box: narrower, leaving: false }]);

    rerender({ box: RIGHT });
    expect(result.current).toEqual([
      { box: narrower, leaving: true },
      { box: RIGHT, leaving: false },
    ]);
  });

  it("fades the box out when nothing is lit", () => {
    const { rerender, result } = glowsFor(LEFT);

    rerender({ box: undefined });

    expect(result.current).toEqual([{ box: LEFT, leaving: true }]);
  });
});
