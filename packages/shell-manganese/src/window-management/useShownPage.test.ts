import { describe, expect, it } from "bun:test";
import { WEBVIEW_PAGE_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { ConnectionSafety } from "../address/connection-safety";
import { useShownPage } from "./useShownPage";

/**
 * A stand-in for the fork's element: the two properties a chrome reads, and
 * the event that tells it to read them again.
 *
 * `defineProperty` rather than assignment because both are readonly on the real
 * element — where the page is and what the connection under it is worth are the
 * browser process's to say, and nothing in the page writes either.
 */
const guest = () => {
  const element = document.createElement("webview");
  const shows = (url: string, security: string) => {
    Object.defineProperties(element, {
      security: { configurable: true, value: security },
      url: { configurable: true, value: url },
    });
    act(() => {
      element.dispatchEvent(new Event(WEBVIEW_PAGE_CHANGE_EVENT));
    });
  };
  Object.defineProperties(element, {
    security: { configurable: true, value: "" },
    url: { configurable: true, value: "" },
  });
  return { element, shows };
};

describe("useShownPage", () => {
  // THE PROPERTIES ARE THE STATE AND THE EVENT IS ONLY A NUDGE, which is the
  // rule every one of these hooks follows — and the one with the most riding
  // on it here: a chrome that learned the security level only from an event
  // would have none at all for the page that was already showing when it
  // mounted, and a browser window that cannot say what its connection is worth
  // is the whole of what this exists to fix.
  it("reads where the view is as it mounts, having heard nothing", () => {
    const view = guest();
    Object.defineProperties(view.element, {
      security: { configurable: true, value: "secure" },
      url: { configurable: true, value: "https://example.com/one" },
    });

    const { result } = renderHook(() => useShownPage(view.element));

    expect(result.current.url).toBe("https://example.com/one");
    expect(result.current.security).toBe(ConnectionSafety.Secure);
  });

  it("reads them again when the view says the page changed", () => {
    const view = guest();
    const { result } = renderHook(() => useShownPage(view.element));

    view.shows("http://example.com", "warning");

    expect(result.current.url).toBe("http://example.com");
    expect(result.current.security).toBe(ConnectionSafety.Warning);
  });

  // WHERE THE PAGE WENT ON ITS OWN, which is the half a shell could never see
  // before: a link followed inside the guest is a page change and nothing else,
  // and the shell never sent the window anywhere.
  it("follows the page into a link it followed by itself", () => {
    const view = guest();
    const { result } = renderHook(() => useShownPage(view.element));
    view.shows("https://example.com", "secure");

    view.shows("https://elsewhere.example/landing", "dangerous");

    expect(result.current.url).toBe("https://elsewhere.example/landing");
    expect(result.current.security).toBe(ConnectionSafety.Dangerous);
  });

  describe("where it has been", () => {
    it("keeps every page it has shown, oldest first", () => {
      const view = guest();
      const { result } = renderHook(() => useShownPage(view.element));

      view.shows("https://example.com", "secure");
      view.shows("https://docs.example.com/guide", "secure");

      expect(result.current.visited).toStrictEqual([
        "https://example.com",
        "https://docs.example.com/guide",
      ]);
    });

    it("does not record the same page twice in a row", () => {
      // The security of a page can change without the page changing — a
      // subresource with a bad certificate arriving after the commit is exactly
      // that — so a visit list keyed on the message rather than on the address
      // would fill up with one page.
      const view = guest();
      const { result } = renderHook(() => useShownPage(view.element));

      view.shows("https://example.com", "secure");
      view.shows("https://example.com", "dangerous");

      expect(result.current.visited).toStrictEqual(["https://example.com"]);
      expect(result.current.security).toBe(ConnectionSafety.Dangerous);
    });

    it("has been nowhere until the browser says otherwise", () => {
      const view = guest();

      const { result } = renderHook(() => useShownPage(view.element));

      expect(result.current.visited).toStrictEqual([]);
      expect(result.current.url).toBe("");
    });
  });

  // AN ENGINE THAT CANNOT SAY IS NOT AN ENGINE SAYING "FINE". The properties
  // do not exist on a `<webview>` older than this contract, so what a chrome
  // reads is `undefined` — and the one thing it must not do with that is draw
  // a padlock.
  it("states nothing for an engine that reports nothing", () => {
    const element = document.createElement("webview");

    const { result } = renderHook(() => useShownPage(element));

    expect(result.current.url).toBe("");
    expect(result.current.security).toBe(ConnectionSafety.Unstated);
  });

  it("says a window with no view of its own yet is showing nothing", () => {
    const { result } = renderHook(() => useShownPage(null));

    expect(result.current.url).toBe("");
    expect(result.current.security).toBe(ConnectionSafety.Unstated);
    expect(result.current.visited).toStrictEqual([]);
  });

  it("lets go of a view it has been taken off", () => {
    const first = guest();
    const second = guest();
    const { rerender, result } = renderHook(
      (view: HTMLWebViewElement) => useShownPage(view),
      { initialProps: first.element },
    );

    rerender(second.element);
    first.shows("https://example.com", "secure");

    expect(result.current.url).toBe("");
  });
});
