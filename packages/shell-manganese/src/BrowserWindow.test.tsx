import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  registerElements,
  WEBVIEW_TAG_NAME,
} from "@domicile/chrome-sdk/register-elements";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import { WEBVIEW_NAVIGATE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrowserWindow } from "./BrowserWindow";

const silentBridge = {
  focusApp: () => undefined,
  focusChrome: () => undefined,
  placePortal: () => undefined,
  removePortal: () => undefined,
  resizeApp: () => undefined,
} as unknown as BridgeClient;

const stubMeasure: Measure = () => ({
  cornerRadius: 0,
  native: true,
  opacity: 1,
  shadow: undefined,
  size: [100, 100],
  takesPointer: true,
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
  zIndex: 0,
});

const view = (container: HTMLElement): DomicileWebviewElement => {
  const element = container.querySelector(WEBVIEW_TAG_NAME);
  if (element === null) {
    throw new Error("test: the browser window rendered no view");
  } else {
    return element as DomicileWebviewElement;
  }
};

const navigateTo = (element: DomicileWebviewElement, url: string): void => {
  act(() => {
    element.dispatchEvent(
      new CustomEvent(WEBVIEW_NAVIGATE_EVENT, { detail: { url } }),
    );
  });
};

const address = (): HTMLInputElement =>
  screen.getByRole("textbox", { name: "Address" });

const browser = (): HTMLElement =>
  screen.getByRole("region", { name: "Browser" });

// What a window's box resolves to is decided by the emitted stylesheet, not by
// any one `css(...)` call: Panda's atomic classes all carry the same
// specificity, so a window's own `display` survives only if nothing later in
// the bundle declares one for the same element. Loading the real sheet is what
// makes that observable — a className on its own says nothing about which of
// two competing declarations wins.
//
// The layers come off first: happy-dom drops `@layer` blocks whole, and Panda
// emits everything inside them. `@media all` keeps the braces balanced and
// matches unconditionally, and the layers are emitted weakest-first, so plain
// source order lands on the same winner the cascade would.
const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  new URL("../styled-system/styles.css", import.meta.url),
  "utf8",
)
  .replaceAll(/@layer [^;{]+;/g, "")
  .replaceAll(/@layer [^{]+\{/g, "@media all{");
document.head.append(stylesheet);

beforeEach(() => {
  registerElements(silentBridge, {
    measure: stubMeasure,
    // Otherwise these suites run the SDK's own animation loop, which happy-dom
    // serves as fast as it can: every mounted window re-measured tens of
    // thousands of times a second, for the length of every `await`.
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window moves.
    },
  });
});

describe("BrowserWindow", () => {
  it("points its view at the address it opened with", () => {
    const { container } = render(
      <BrowserWindow
        clickThrough={false}
        dragging={false}
        floating={undefined}
        focused
        onNavigate={() => undefined}
        onScreen
        src="https://example.com"
      />,
    );
    expect(view(container).getAttribute("src")).toBe("https://example.com");
    expect(address()).toHaveValue("https://example.com");
  });

  describe("the address bar", () => {
    it("loads what was typed, filling in a missing scheme", async () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onScreen
          src="https://example.com"
        />,
      );
      await userEvent.clear(address());
      await userEvent.type(address(), "docs.example.com{Enter}");
      expect(view(container).getAttribute("src")).toBe(
        "https://docs.example.com",
      );
    });

    it("follows the page wherever it goes", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onScreen
          src="https://example.com"
        />,
      );
      navigateTo(view(container), "https://example.com/deep/link");
      expect(address()).toHaveValue("https://example.com/deep/link");
    });

    it("reports each navigation so the window's tab can be retitled", () => {
      const seen: string[] = [];
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={(url) => {
            seen.push(url);
          }}
          onScreen
          src="https://example.com"
        />,
      );
      navigateTo(view(container), "https://docs.example.com/");
      expect(seen).toStrictEqual(["https://docs.example.com/"]);
    });
  });

  describe("the page", () => {
    it("takes the whole stage under the address bar", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onScreen
          src="https://example.com"
        />,
      );
      // The window stacks the bar over the page and hands the page whatever
      // height the bar leaves...
      expect(globalThis.getComputedStyle(browser()).display).toBe("flex");
      expect(globalThis.getComputedStyle(browser()).flexDirection).toBe(
        "column",
      );
      // ...and the view passes that height straight through to the embed
      // inside it, which has no height of its own to fall back on.
      const embed = globalThis.getComputedStyle(view(container));
      expect(embed.display).toBe("flex");
      expect(embed.flexDirection).toBe("column");
    });
  });

  it("hides the window when it is not on the stage", () => {
    render(
      <BrowserWindow
        clickThrough={false}
        dragging={false}
        floating={undefined}
        focused={false}
        onNavigate={() => undefined}
        onScreen={false}
        src="https://example.com"
      />,
    );
    // A hidden element is out of the accessibility tree, so it has no
    // accessible name left to match on — being the only region is enough.
    expect(screen.getByRole("region", { hidden: true })).not.toBeVisible();
  });
});
