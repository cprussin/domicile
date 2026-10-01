import { describe, expect, it, jest } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { useNow } from "./useNow";

describe("useNow", () => {
  it("is the clock's reading, read again every half minute", () => {
    jest.useFakeTimers();
    const readings = [1000, 31_000];
    const { result } = renderHook(() =>
      useNow(() => readings.shift() ?? 61_000),
    );

    expect(result.current).toBe(1000);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(result.current).toBe(31_000);
    jest.useRealTimers();
  });
});
