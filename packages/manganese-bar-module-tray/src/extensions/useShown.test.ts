import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_CONTENT_SIZE_CHANGE_EVENT,
  WEBVIEW_LOADING_CHANGE_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useShown } from "./useShown";

/**
 * A fake popup `<webview>` with `loading`, its content size and their events.
 * `defineProperties` because both are readonly on the real element.
 */
const popup = () => {
  const element = document.createElement("webview");
  const is = (loading: boolean, width: number, height: number) => {
    Object.defineProperties(element, {
      contentHeight: { configurable: true, value: height },
      contentWidth: { configurable: true, value: width },
      loading: { configurable: true, value: loading },
    });
  };
  const loadingChanged = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_LOADING_CHANGE_EVENT));
    });
  };
  const sizeChanged = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_CONTENT_SIZE_CHANGE_EVENT));
    });
  };
  is(false, 0, 0);
  return { element, is, loadingChanged, sizeChanged };
};

describe("useShown", () => {
  it("withholds a page that has neither loaded nor sized itself", () => {
    const view = popup();
    const { result } = renderHook(() => useShown(view.element));
    expect(result.current).toBe(false);
  });

  it("shows a page once it has sized itself and finished loading", () => {
    const view = popup();
    const { result } = renderHook(() => useShown(view.element));
    view.is(true, 0, 0);
    view.loadingChanged();
    view.is(true, 360, 600);
    view.sizeChanged();
    const whileLoading = result.current;
    view.is(false, 360, 600);
    view.loadingChanged();
    expect([whileLoading, result.current]).toStrictEqual([false, true]);
  });

  // A popup whose page loaded before the first effect ran would never hear
  // an event.
  it("reads a page that loaded and sized itself before it mounted", () => {
    const view = popup();
    view.is(false, 360, 600);
    const { result } = renderHook(() => useShown(view.element));
    expect(result.current).toBe(true);
  });

  // Chrome shows its popup once; a page that navigates is not hidden again.
  it("keeps showing a page that loads again", () => {
    const view = popup();
    view.is(false, 360, 600);
    const { result } = renderHook(() => useShown(view.element));
    view.is(true, 360, 600);
    view.loadingChanged();
    expect(result.current).toBe(true);
  });

  it("withholds a new view, though the last one was shown", () => {
    const first = popup();
    const second = popup();
    first.is(false, 360, 600);
    const { rerender, result } = renderHook(
      (view: HTMLWebViewElement | null) => useShown(view),
      { initialProps: first.element },
    );
    rerender(second.element);
    expect(result.current).toBe(false);
  });

  it("withholds a popup with no view yet", () => {
    const { result } = renderHook(() => useShown(null));
    expect(result.current).toBe(false);
  });
});
