import { describe, expect, it } from "bun:test";
import { WEBVIEW_LOADING_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useLoading } from "./useLoading";

/**
 * A fake `<webview>` with `loading` and the change event. `defineProperty`
 * because `loading` is readonly on the real element.
 */
const guest = () => {
  const element = document.createElement("webview");
  const loads = (loading: boolean) => {
    Object.defineProperty(element, "loading", {
      configurable: true,
      value: loading,
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_LOADING_CHANGE_EVENT));
    });
  };
  loads(false);
  return { changed, element, loads };
};

describe("useLoading", () => {
  // The hook must read on mount: a guest may start loading before the first
  // effect runs, and that event is missed.
  it("reads whether the view is loading as it mounts, having heard nothing", () => {
    const view = guest();
    view.loads(true);
    const { result } = renderHook(() => useLoading(view.element));
    expect(result.current).toBe(true);
  });

  it("reads it again when the view says it started or stopped", () => {
    const view = guest();
    const { result } = renderHook(() => useLoading(view.element));
    view.loads(true);
    view.changed();
    expect(result.current).toBe(true);
    view.loads(false);
    view.changed();
    expect(result.current).toBe(false);
  });

  it("says a window with no view of its own yet is loading nothing", () => {
    const { result } = renderHook(() => useLoading(null));
    expect(result.current).toBe(false);
  });

  it("lets go of a view it has been taken off", () => {
    const first = guest();
    const second = guest();
    const { rerender, result } = renderHook(
      (view: HTMLWebViewElement) => useLoading(view),
      { initialProps: first.element },
    );
    rerender(second.element);
    first.loads(true);
    first.changed();
    expect(result.current).toBe(false);
  });
});
