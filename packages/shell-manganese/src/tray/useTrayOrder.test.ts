import { beforeEach, describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { ORDER_KEY, rememberOrder } from "./remembered-order";
import { useTrayOrder } from "./useTrayOrder";

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("useTrayOrder", () => {
  it("starts from the order last remembered", () => {
    rememberOrder(["b", "a"]);

    const { result } = renderHook(() => useTrayOrder());

    expect(result.current.order).toStrictEqual(["b", "a"]);
  });

  it("moves an item, and remembers the move", () => {
    const { result } = renderHook(() => useTrayOrder());

    act(() => {
      result.current.move(["a", "b"], "b", "a");
    });

    expect(result.current.order).toStrictEqual(["b", "a"]);
    expect(renderHook(() => useTrayOrder()).result.current.order).toStrictEqual(
      ["b", "a"],
    );
  });

  it("follows a move made on another page of the desk", () => {
    // Each monitor can be a page of its own, and a drag on one bar is a drag
    // on all of them. The browser tells the others by a `storage` event.
    const { result } = renderHook(() => useTrayOrder());

    act(() => {
      globalThis.dispatchEvent(
        new StorageEvent("storage", {
          key: ORDER_KEY,
          newValue: JSON.stringify(["c", "a"]),
        }),
      );
    });

    expect(result.current.order).toStrictEqual(["c", "a"]);
  });

  it("ignores what another page writes under another key", () => {
    rememberOrder(["a"]);
    const { result } = renderHook(() => useTrayOrder());

    act(() => {
      globalThis.dispatchEvent(
        new StorageEvent("storage", { key: "theme:v2", newValue: "light" }),
      );
    });

    expect(result.current.order).toStrictEqual(["a"]);
  });
});
