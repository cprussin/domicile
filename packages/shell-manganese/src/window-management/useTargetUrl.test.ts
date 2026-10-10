import { describe, expect, it } from "bun:test";
import { WEBVIEW_TARGET_URL_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useTargetUrl } from "./useTargetUrl";

/**
 * A fake `<webview>` with `targetUrl` and the change event. `defineProperty`
 * because `targetUrl` is readonly on the real element.
 */
const guest = () => {
  const element = document.createElement("webview");
  const hovers = (url: string) => {
    Object.defineProperty(element, "targetUrl", {
      configurable: true,
      value: url,
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_TARGET_URL_CHANGE_EVENT));
    });
  };
  hovers("");
  return { changed, element, hovers };
};

describe("useTargetUrl", () => {
  it("reads the view's link as it mounts, having heard nothing", () => {
    const view = guest();
    view.hovers("https://example.com/a");
    const { result } = renderHook(() => useTargetUrl(view.element));
    expect(result.current).toBe("https://example.com/a");
  });

  it("reads it again when the view says it changed", () => {
    const view = guest();
    const { result } = renderHook(() => useTargetUrl(view.element));
    view.hovers("https://example.com/b");
    view.changed();
    expect(result.current).toBe("https://example.com/b");
  });

  it("says a window with no view yet is over no link", () => {
    const { result } = renderHook(() => useTargetUrl(null));
    expect(result.current).toBe("");
  });
});
