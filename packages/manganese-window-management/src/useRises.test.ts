import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { useRises } from "./useRises";

describe("useRises", () => {
  // A count already up when the window opens is old news.
  it("counts nothing as it mounts", () => {
    const { result } = renderHook(() => useRises(3));
    expect(result.current).toBe(0);
  });

  it("counts each time the value goes up", () => {
    const { rerender, result } = renderHook(({ value }) => useRises(value), {
      initialProps: { value: 0 },
    });
    rerender({ value: 1 });
    rerender({ value: 3 });
    expect(result.current).toBe(2);
  });

  // Clearing finished downloads drops the count to 0; that is no finish.
  it("does not count the value going down", () => {
    const { rerender, result } = renderHook(({ value }) => useRises(value), {
      initialProps: { value: 2 },
    });
    rerender({ value: 0 });
    expect(result.current).toBe(0);
    rerender({ value: 1 });
    expect(result.current).toBe(1);
  });
});
