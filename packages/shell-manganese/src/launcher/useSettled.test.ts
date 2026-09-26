import { describe, expect, it } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";

import { useSettled } from "./useSettled";

describe("useSettled", () => {
  it("starts on the value it was given", () => {
    const { result } = renderHook(() => useSettled("a", 50));

    expect(result.current).toBe("a");
  });

  it("holds the last settled value until a new one has stood for the delay", async () => {
    // A preview per keystroke is a page loaded and thrown away per keystroke.
    const { rerender, result } = renderHook(
      ({ value }) => useSettled(value, 50),
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
