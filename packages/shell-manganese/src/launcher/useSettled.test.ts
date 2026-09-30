import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useSettled } from "./useSettled";

describe("useSettled", () => {
  it("starts on the value it was given", () => {
    const { result } = renderHook(() => useSettled("a", "a", 50));

    expect(result.current).toBe("a");
  });

  it("holds the last settled value until a new key has stood for the delay", async () => {
    // A preview per keystroke is a page loaded and thrown away per keystroke.
    const { rerender, result } = renderHook(
      ({ value }) => useSettled(value, value, 50),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    rerender({ value: "abc" });

    expect(result.current).toBe("a");
    await waitFor(() => {
      expect(result.current).toBe("abc");
    });
  });

  it("does not wait again for a new value of the key it is waiting on", async () => {
    // A choice is a new object on every render, and the panel renders on
    // every answer the host sends: it is the key that has to stand.
    const first = { at: 0 };
    const { rerender, result } = renderHook(
      ({ key, value }) => useSettled(value, key, 50),
      { initialProps: { key: "a", value: first } },
    );
    for (const at of [1, 2, 3, 4]) {
      rerender({ key: "b", value: { at } });
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    }

    expect(result.current).not.toBe(first);
  });

  it("is the value as its key has it now, once that key has settled", async () => {
    // What the host sent again for the same row — its icon found since — is
    // what is drawn, not the copy the row settled with.
    const { rerender, result } = renderHook(
      ({ key, value }) => useSettled(value, key, 50),
      { initialProps: { key: "a", value: { at: 0 } } },
    );
    rerender({ key: "b", value: { at: 1 } });
    await waitFor(() => {
      expect(result.current).toStrictEqual({ at: 1 });
    });
    rerender({ key: "b", value: { at: 2 } });

    expect(result.current).toStrictEqual({ at: 2 });
  });
});
