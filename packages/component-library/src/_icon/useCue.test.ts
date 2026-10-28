import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";

import { useCue } from "./useCue";

describe(useCue, () => {
  it("has not played on mount", () => {
    const { result } = renderHook(() => useCue(3));
    expect(result.current).toBe(0);
  });

  it("counts each change to a new value", () => {
    const { rerender, result } = renderHook(({ cue }) => useCue(cue), {
      initialProps: { cue: 1 as number | undefined },
    });
    rerender({ cue: 2 });
    rerender({ cue: 2 });
    rerender({ cue: 3 });
    expect(result.current).toBe(2);
  });

  it("does not play for a change to undefined", () => {
    const { rerender, result } = renderHook(({ cue }) => useCue(cue), {
      initialProps: { cue: 1 as number | undefined },
    });
    rerender({ cue: undefined });
    expect(result.current).toBe(0);
  });
});
