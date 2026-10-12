import { describe, expect, it } from "bun:test";
import { WEBVIEW_DOWNLOADS_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useDownloads } from "./useDownloads";

/**
 * A fake `<webview>` with the download properties and the change event.
 * `defineProperty` because they are readonly on the real element.
 */
const guest = () => {
  const element = document.createElement("webview");
  const downloads = (
    count: number,
    receivedBytes: number,
    totalBytes: number,
  ) => {
    Object.defineProperty(element, "downloadCount", {
      configurable: true,
      value: count,
    });
    Object.defineProperty(element, "downloadReceivedBytes", {
      configurable: true,
      value: receivedBytes,
    });
    Object.defineProperty(element, "downloadTotalBytes", {
      configurable: true,
      value: totalBytes,
    });
  };
  const changed = () => {
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_DOWNLOADS_CHANGE_EVENT));
    });
  };
  downloads(0, 0, 0);
  return { changed, downloads, element };
};

describe("useDownloads", () => {
  // A download may have started before the first effect runs, and that event
  // is missed.
  it("reads the page's downloads as it mounts, having heard nothing", () => {
    const view = guest();
    view.downloads(1, 10, 100);
    const { result } = renderHook(() => useDownloads(view.element));
    expect(result.current).toStrictEqual({
      count: 1,
      receivedBytes: 10,
      totalBytes: 100,
    });
  });

  it("reads them again when the view says they changed", () => {
    const view = guest();
    const { result } = renderHook(() => useDownloads(view.element));
    view.downloads(2, 30, 0);
    view.changed();
    expect(result.current).toStrictEqual({
      count: 2,
      receivedBytes: 30,
      totalBytes: 0,
    });
  });

  it("says a window with no view of its own yet downloads nothing", () => {
    const { result } = renderHook(() => useDownloads(null));
    expect(result.current).toStrictEqual({
      count: 0,
      receivedBytes: 0,
      totalBytes: 0,
    });
  });

  it("lets go of a view it has been taken off", () => {
    const first = guest();
    const second = guest();
    const { rerender, result } = renderHook(
      (view: HTMLWebViewElement) => useDownloads(view),
      { initialProps: first.element },
    );
    rerender(second.element);
    first.downloads(1, 10, 100);
    first.changed();
    expect(result.current.count).toBe(0);
  });
});
