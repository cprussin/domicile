import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { useOverviewPhase } from "./useOverviewPhase";

const rendered = (open: boolean) =>
  renderHook((next: boolean) => useOverviewPhase(next), {
    initialProps: open,
  });

describe("useOverviewPhase", () => {
  it("is open while the desk says so, and nothing before", () => {
    const { rerender, result } = rendered(false);
    expect(result.current.phase).toBeUndefined();

    rerender(true);

    expect(result.current.phase).toBe("open");
  });

  it("closes until its closing has played out", () => {
    const { rerender, result } = rendered(true);

    rerender(false);
    expect(result.current.phase).toBe("closing");
    act(() => {
      result.current.closed();
    });

    expect(result.current.phase).toBeUndefined();
  });

  it("opens again straight from closing", () => {
    const { rerender, result } = rendered(true);
    rerender(false);

    rerender(true);

    expect(result.current.phase).toBe("open");
  });
});
