import { beforeEach, describe, expect, it } from "bun:test";

import type { BridgeClient } from "./bridge";
import { registerElements, WEBVIEW_TAG_NAME } from "./register-elements";
import type { DomicileWebviewElement } from "./webview-element";

describe("<domicile-webview>", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // The webview element ignores the bridge, but registration is what defines
    // the custom element.
    registerElements({} as BridgeClient);
  });

  it("reflects src and embeds an inner view when connected", () => {
    const element = document.createElement(
      WEBVIEW_TAG_NAME,
    ) as DomicileWebviewElement;
    element.setAttribute("src", "https://example.com");
    document.body.append(element);

    expect(element.src).toBe("https://example.com");
    const view = element.querySelector(".domicile-webview-frame");
    expect(view?.getAttribute("src")).toBe("https://example.com");
  });
});
