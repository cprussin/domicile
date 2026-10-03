import { describe, expect, it } from "bun:test";
import { WEBVIEW_ZOOM_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useZoom } from "./useZoom";

/**
 * A stand-in for the fork's element: the zoom a chrome reads, and the event
 * that tells it to read it again. `defineProperty` because it is readonly on
 * the real element — the zoom is the browser's answer.
 */
const guest = () => {
  const element = document.createElement("webview");
  const zoomed = (factor: number) => {
    Object.defineProperty(element, "zoom", {
      configurable: true,
      value: factor,
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_ZOOM_CHANGE_EVENT));
    });
  };
  zoomed(1);
  return { changed, element, zoomed };
};

describe("useZoom", () => {
  it("reads the view's zoom as it mounts, having heard nothing", () => {
    const view = guest();
    view.zoomed(1.5);
    const { result } = renderHook(() => useZoom(view.element));
    expect(result.current).toBe(1.5);
  });

  it("reads it again when the view says it changed", () => {
    const view = guest();
    const { result } = renderHook(() => useZoom(view.element));
    view.zoomed(0.9);
    view.changed();
    expect(result.current).toBe(0.9);
  });

  it("says a window with no view yet is at 100%", () => {
    const { result } = renderHook(() => useZoom(null));
    expect(result.current).toBe(1);
  });
});
