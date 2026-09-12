import { describe, expect, it } from "bun:test";
import { WEBVIEW_HISTORY_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useHistoryAvailability } from "./useHistoryAvailability";

const NOWHERE = { canGoBack: false, canGoForward: false };

/**
 * A stand-in for the fork's element: the two properties a chrome reads, and
 * the event that tells it to read them again.
 *
 * `defineProperties` rather than assignment because they are readonly on the
 * real element — where the guest's history can reach is the browser process's
 * to say, and nothing in the page writes it.
 */
const guest = () => {
  const element = document.createElement("webview");
  const goes = (canGoBack: boolean, canGoForward: boolean) => {
    Object.defineProperties(element, {
      canGoBack: { configurable: true, value: canGoBack },
      canGoForward: { configurable: true, value: canGoForward },
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_HISTORY_CHANGE_EVENT));
    });
  };
  goes(false, false);
  return { changed, element, goes };
};

describe("useHistoryAvailability", () => {
  // THE PROPERTIES ARE THE STATE AND THE EVENT IS ONLY A NUDGE. A chrome that
  // learned where the history reaches from the event alone would know nothing
  // about a guest that committed its page before this hook's first effect ran,
  // and would go on saying so until the user navigated again.
  it("reads what the view can do as it mounts, having heard nothing", () => {
    const view = guest();
    view.goes(true, true);
    const { result } = renderHook(() => useHistoryAvailability(view.element));
    expect(result.current).toStrictEqual({
      canGoBack: true,
      canGoForward: true,
    });
  });

  it("reads them again when the view says its history changed", () => {
    const view = guest();
    const { result } = renderHook(() => useHistoryAvailability(view.element));
    view.goes(true, false);
    view.changed();
    expect(result.current).toStrictEqual({
      canGoBack: true,
      canGoForward: false,
    });
  });

  it("says a window with no view of its own yet can go nowhere", () => {
    const { result } = renderHook(() => useHistoryAvailability(null));
    expect(result.current).toStrictEqual(NOWHERE);
  });

  it("lets go of a view it has been taken off", () => {
    const first = guest();
    const second = guest();
    const { rerender, result } = renderHook(
      (view: HTMLWebViewElement) => useHistoryAvailability(view),
      { initialProps: first.element },
    );
    rerender(second.element);
    first.goes(true, true);
    first.changed();
    expect(result.current).toStrictEqual(NOWHERE);
  });
});
