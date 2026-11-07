import { describe, expect, it } from "bun:test";
import { WEBVIEW_TOOLTIP_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { usePageTooltip } from "./usePageTooltip";

/**
 * A fake `<webview>` with the tooltip attributes and the change event.
 * `defineProperty` because they are readonly on the real element.
 */
const guest = () => {
  const element = document.createElement("webview");
  const shows = (text: string, x: number, y: number) => {
    for (const [name, value] of [
      ["tooltip", text],
      ["tooltipX", x],
      ["tooltipY", y],
    ] as const) {
      Object.defineProperty(element, name, { configurable: true, value });
    }
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_TOOLTIP_CHANGE_EVENT));
    });
  };
  shows("", 0, 0);
  return { changed, element, shows };
};

describe("usePageTooltip", () => {
  it("reads the view's tooltip as it mounts, having heard nothing", () => {
    const view = guest();
    view.shows("Bold", 10, 20);
    const { result } = renderHook(() => usePageTooltip(view.element));
    expect(result.current).toEqual({ text: "Bold", x: 10, y: 20 });
  });

  it("reads it again when the view says it changed", () => {
    const view = guest();
    const { result } = renderHook(() => usePageTooltip(view.element));
    view.shows("Italic", 30, 40);
    view.changed();
    expect(result.current).toEqual({ text: "Italic", x: 30, y: 40 });
  });

  it("says a window with no view yet shows no tooltip", () => {
    const { result } = renderHook(() => usePageTooltip(null));
    expect(result.current.text).toBe("");
  });
});
