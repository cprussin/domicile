import { describe, expect, it } from "bun:test";
import { WEBVIEW_PAGE_FULLSCREEN_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { usePageFullscreen } from "./usePageFullscreen";

/**
 * A fake `<webview>` with `pageFullscreen`, its change event and
 * `exitPageFullscreen`, which counts its calls. `defineProperty` because
 * `pageFullscreen` is readonly on the real element.
 */
const guest = () => {
  const element = document.createElement("webview");
  const exits = { count: 0 };
  const fullscreens = (fullscreen: boolean) => {
    Object.defineProperty(element, "pageFullscreen", {
      configurable: true,
      value: fullscreen,
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_PAGE_FULLSCREEN_CHANGE_EVENT));
    });
  };
  element.exitPageFullscreen = () => {
    exits.count += 1;
  };
  fullscreens(false);
  return { changed, element, exits, fullscreens };
};

describe("usePageFullscreen", () => {
  it("reports the page's fullscreen as it mounts", async () => {
    const view = guest();
    view.fullscreens(true);
    const reported = await new Promise<boolean>((resolve) => {
      renderHook(() => usePageFullscreen(view.element, false, resolve));
    });
    expect(reported).toBe(true);
  });

  it("reports it again when the view says it changed", () => {
    const view = guest();
    const reports: boolean[] = [];
    renderHook(() =>
      usePageFullscreen(view.element, false, (fullscreen) => {
        reports.push(fullscreen);
      }),
    );
    view.fullscreens(true);
    view.changed();
    expect(reports).toEqual([false, true]);
  });

  it("takes the page out of fullscreen when the window leaves it", () => {
    const view = guest();
    view.fullscreens(true);
    const { rerender } = renderHook(
      ({ fullscreen }) =>
        usePageFullscreen(view.element, fullscreen, () => undefined),
      { initialProps: { fullscreen: true } },
    );
    rerender({ fullscreen: false });
    expect(view.exits.count).toBe(1);
  });

  it("leaves a fullscreen page alone in a window that was never fullscreen", () => {
    // The page enters fullscreen before the window follows it.
    const view = guest();
    view.fullscreens(true);
    const { rerender } = renderHook(
      ({ fullscreen }) =>
        usePageFullscreen(view.element, fullscreen, () => undefined),
      { initialProps: { fullscreen: false } },
    );
    rerender({ fullscreen: false });
    expect(view.exits.count).toBe(0);
  });
});
