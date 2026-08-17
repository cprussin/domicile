import { beforeEach, describe, expect, it } from "bun:test";

import type { BridgeClient } from "./bridge";
import { registerElements, WEBVIEW_TAG_NAME } from "./register-elements";
import type { DomicileWebviewElement } from "./webview-element";
import { WEBVIEW_NAVIGATE_EVENT } from "./webview-element";

// The embedded view is Electron's `<webview>`, whose navigation methods and
// navigation events only exist in Electron; a test DOM creates a bare element,
// so the test stands the same surface up on it by hand.
const embedOf = (element: DomicileWebviewElement): Element => {
  const view = element.querySelector(".domicile-webview-frame");
  if (view === null) {
    throw new Error("test setup: the webview never embedded a view");
  }
  return view;
};

const mountWebview = (src: string): DomicileWebviewElement => {
  const element = document.createElement(
    WEBVIEW_TAG_NAME,
  ) as DomicileWebviewElement;
  element.setAttribute("src", src);
  document.body.append(element);
  return element;
};

const navigateEmbed = (view: Element, url: string): void => {
  view.dispatchEvent(Object.assign(new Event("did-navigate"), { url }));
};

describe("<domicile-webview>", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // The webview element ignores the bridge, but registration is what defines
    // the custom element.
    registerElements({} as BridgeClient);
  });

  it("reflects src and embeds an inner view when connected", () => {
    const element = mountWebview("https://example.com");

    expect(element.src).toBe("https://example.com");
    expect(embedOf(element).getAttribute("src")).toBe("https://example.com");
  });

  describe("navigation", () => {
    it("drives the embedded view's history and loading", () => {
      const element = mountWebview("https://example.com");
      const calls: string[] = [];
      Object.assign(embedOf(element), {
        goBack: () => calls.push("goBack"),
        goForward: () => calls.push("goForward"),
        reload: () => calls.push("reload"),
        stop: () => calls.push("stop"),
      });

      element.goBack();
      element.goForward();
      element.stop();
      element.reload();
      expect(calls).toEqual(["goBack", "goForward", "stop", "reload"]);
    });

    it("tracks where the embedded view navigated on its own", async () => {
      const element = mountWebview("https://example.com");

      const detail = await new Promise((resolve) => {
        element.addEventListener(WEBVIEW_NAVIGATE_EVENT, (event) => {
          resolve((event as CustomEvent<{ url: string }>).detail);
        });
        navigateEmbed(embedOf(element), "https://example.com/page");
      });

      expect(detail).toEqual({ url: "https://example.com/page" });
      expect(element.src).toBe("https://example.com/page");
    });

    it("does not re-load a page the embedded view navigated to itself", () => {
      const element = mountWebview("https://example.com");
      const view = embedOf(element);

      navigateEmbed(view, "https://example.com/page");
      // Pushing the URL back onto the embed would restart the load the embed
      // just finished; only a src the chrome sets is a navigation request.
      expect(view.getAttribute("src")).toBe("https://example.com");

      element.src = "https://other.example";
      expect(view.getAttribute("src")).toBe("https://other.example");
    });
  });
});
