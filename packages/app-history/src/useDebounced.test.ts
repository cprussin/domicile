import { describe, expect, it } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";

import { useDebounced } from "./useDebounced";

describe(useDebounced, () => {
  it("follows the value once it settles", async () => {
    const { rerender, result } = renderHook(
      ({ value }) => useDebounced(value, 20),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    rerender({ value: "abc" });
    expect(result.current).toBe("a");
    await waitFor(() => {
      expect(result.current).toBe("abc");
    });
  });
});
