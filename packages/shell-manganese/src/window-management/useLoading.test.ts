import { describe, expect, it } from "bun:test";
import { WEBVIEW_LOADING_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useLoading } from "./useLoading";

/**
 * A stand-in for the fork's element: the property a chrome reads, and the
 * event that tells it to read it again.
 *
 * `defineProperty` rather than assignment because it is readonly on the real
 * element — whether the guest is still fetching its page is the browser
 * process's to say, and nothing in the page writes it.
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
  // THE PROPERTY IS THE STATE AND THE EVENT IS ONLY A NUDGE. A chrome that
  // learned this from the event alone would know nothing about a guest that
  // started loading before this hook's first effect ran, and would show a
  // settled window over a page still on its way.
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
