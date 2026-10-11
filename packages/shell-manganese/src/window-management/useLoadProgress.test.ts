import { describe, expect, it } from "bun:test";
import { WEBVIEW_LOAD_PROGRESS_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useLoadProgress } from "./useLoadProgress";

/**
 * A fake `<webview>` with `loadProgress` and the change event.
 * `defineProperty` because `loadProgress` is readonly on the real element.
 */
const guest = () => {
  const element = document.createElement("webview");
  const progresses = (progress: number) => {
    Object.defineProperty(element, "loadProgress", {
      configurable: true,
      value: progress,
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_LOAD_PROGRESS_CHANGE_EVENT));
    });
  };
  progresses(0);
  return { changed, element, progresses };
};

describe("useLoadProgress", () => {
  // A load may have started before the first effect runs, and that event is
  // missed.
  it("reads how far the page has loaded as it mounts, having heard nothing", () => {
    const view = guest();
    view.progresses(0.4);
    const { result } = renderHook(() => useLoadProgress(view.element));
    expect(result.current).toBe(0.4);
  });

  it("reads it again when the view says it moved", () => {
    const view = guest();
    const { result } = renderHook(() => useLoadProgress(view.element));
    view.progresses(0.7);
    view.changed();
    expect(result.current).toBe(0.7);
  });

  it("says a window with no view of its own yet has loaded nothing", () => {
    const { result } = renderHook(() => useLoadProgress(null));
    expect(result.current).toBe(0);
  });

  it("lets go of a view it has been taken off", () => {
    const first = guest();
    const second = guest();
    const { rerender, result } = renderHook(
      (view: HTMLWebViewElement) => useLoadProgress(view),
      { initialProps: first.element },
    );
    rerender(second.element);
    first.progresses(0.5);
    first.changed();
    expect(result.current).toBe(0);
  });
});
