import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { useLowered } from "./useLowered";

const loweredFrom = (first: number) =>
  renderHook(({ depth }) => useLowered(depth), {
    initialProps: { depth: first },
  });

describe("useLowered", () => {
  it("is false for a depth that has not changed", () => {
    expect(loweredFrom(2).result.current).toBe(false);
  });

  it("is true once the depth drops", () => {
    const { rerender, result } = loweredFrom(2000);

    rerender({ depth: 0 });

    expect(result.current).toBe(true);
  });

  it("is false once the depth rises", () => {
    const { rerender, result } = loweredFrom(2000);
    rerender({ depth: 0 });

    rerender({ depth: 2 });

    expect(result.current).toBe(false);
  });

  // The `z-index` transition starts on the change, so only the change needs
  // the flag; keeping it is harmless.
  it("stays true across renders that keep the depth", () => {
    const { rerender, result } = loweredFrom(2000);
    rerender({ depth: 0 });

    rerender({ depth: 0 });

    expect(result.current).toBe(true);
  });
});
