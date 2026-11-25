import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { useDevicePixelRatio } from "./useDevicePixelRatio";

/**
 * A view at `ratio`, whose `(resolution: …)` queries fire `change` when
 * `rescale` moves it, as a screen at another scale does.
 */
const fakeView = (ratio: number) => {
  const queries = new Map<string, EventTarget>();
  const view = {
    devicePixelRatio: ratio,
    matchMedia: (query: string) => {
      const list = queries.get(query) ?? new EventTarget();
      queries.set(query, list);
      return list;
    },
  };
  return {
    rescale: (next: number) => {
      const was = queries.get(
        `(resolution: ${view.devicePixelRatio.toString()}dppx)`,
      );
      view.devicePixelRatio = next;
      was?.dispatchEvent(new Event("change"));
    },
    view,
  };
};

describe("useDevicePixelRatio", () => {
  it("is the view's ratio", () => {
    const { view } = fakeView(1.5);
    const { result } = renderHook(() => useDevicePixelRatio(view));

    expect(result.current).toBe(1.5);
  });

  it("follows the ratio through every change", () => {
    const { rescale, view } = fakeView(1);
    const { result } = renderHook(() => useDevicePixelRatio(view));
    act(() => {
      rescale(2);
    });
    act(() => {
      rescale(1.25);
    });

    expect(result.current).toBe(1.25);
  });
});
