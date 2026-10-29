import { describe, expect, it } from "bun:test";
import { WEBVIEW_WAKE_LOCK_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useWakeLockedPages } from "./wake-locked-pages";

/**
 * A fake `<webview>` showing `url` with `favicon`. `defineProperty` because
 * its state is readonly on the real element.
 */
const guest = (url: string, favicon: string) => {
  const element = document.createElement("webview");
  Object.defineProperty(element, "url", { value: url });
  Object.defineProperty(element, "favicon", { value: favicon });
  const locks = (held: boolean) => {
    Object.defineProperty(element, "wakeLock", {
      configurable: true,
      value: held,
    });
    act(() => {
      element.dispatchEvent(
        new Event(WEBVIEW_WAKE_LOCK_CHANGE_EVENT, { bubbles: true }),
      );
    });
  };
  Object.defineProperty(element, "wakeLock", {
    configurable: true,
    value: false,
  });
  return { element, locks };
};

describe("useWakeLockedPages", () => {
  it("names each page keeping the screens on by its site, as it changes", () => {
    const page = document.createElement("div");
    const film = guest(
      "https://www.youtube.com/watch?v=1",
      "https://www.youtube.com/favicon.ico",
    );
    const call = guest("https://meet.example.com/room", "");
    page.append(film.element, call.element);
    const { result } = renderHook(() => useWakeLockedPages(page));
    expect(result.current).toEqual([]);

    film.locks(true);
    call.locks(true);
    expect(result.current).toEqual([
      { icon: "https://www.youtube.com/favicon.ico", site: "youtube.com" },
      { icon: undefined, site: "meet.example.com" },
    ]);

    film.locks(false);
    expect(result.current).toEqual([
      { icon: undefined, site: "meet.example.com" },
    ]);
  });
});
