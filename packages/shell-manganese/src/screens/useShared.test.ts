import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { useShared } from "./useShared";

describe("useShared", () => {
  it("keeps the last value through an equal one", () => {
    const { rerender, result } = renderHook(({ value }) => useShared(value), {
      initialProps: { value: [{ x: 1 }] },
    });
    const before = result.current;

    rerender({ value: [{ x: 1 }] });

    expect(result.current).toBe(before);
  });
});
