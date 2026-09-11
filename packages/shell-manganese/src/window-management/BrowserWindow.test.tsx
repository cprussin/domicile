import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  registerElements,
  WEBVIEW_TAG_NAME,
} from "@domicile/chrome-sdk/register-elements";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import {
  WEBVIEW_GUEST_FOCUS_EVENT,
  WEBVIEW_NAVIGATE_EVENT,
} from "@domicile/chrome-sdk/webview-element";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrowserWindow } from "./BrowserWindow";

const silentDomicile = {
  focusApp: () => undefined,
  focusChrome: () => undefined,
  resizeApp: () => undefined,
} as unknown as DomicileClient;

/** A domicile client that keeps what the window told the host, in order. */
const recordingDomicile = (calls: string[]): DomicileClient =>
  ({
    ...silentDomicile,
    focusChrome: () => {
      calls.push("focusChrome");
    },
  }) as unknown as DomicileClient;

const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
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
  new URL("../../styled-system/styles.css", import.meta.url),
  "utf8",
)
  .replaceAll(/@layer [^;{]+;/g, "")
  .replaceAll(/@layer [^{]+\{/g, "@media all{");
document.head.append(stylesheet);

beforeEach(() => {
  registerElements(silentDomicile, {
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
        domicile={silentDomicile}
        dragging={false}
        floating={undefined}
        focused
        onNavigate={() => undefined}
        onReach={() => undefined}
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
          domicile={silentDomicile}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onReach={() => undefined}
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
          domicile={silentDomicile}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onReach={() => undefined}
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
          domicile={silentDomicile}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={(url) => {
            seen.push(url);
          }}
          onReach={() => undefined}
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
          domicile={silentDomicile}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onReach={() => undefined}
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

  describe("the keyboard", () => {
    // The window the user is working in takes the keyboard, and the compositor
    // has one seat: whatever held it before must be told it no longer does, or
    // `wl_keyboard` focus strands on a client the user has switched away from
    // and every key they type goes to a window they cannot see.
    it("tells the host no client holds the keyboard when it takes focus", () => {
      const calls: string[] = [];
      render(
        <BrowserWindow
          clickThrough={false}
          domicile={recordingDomicile(calls)}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onReach={() => undefined}
          onScreen
          src="https://example.com"
        />,
      );
      expect(calls).toStrictEqual(["focusChrome"]);
    });

    it("says nothing while the user is working somewhere else", () => {
      const calls: string[] = [];
      render(
        <BrowserWindow
          clickThrough={false}
          domicile={recordingDomicile(calls)}
          dragging={false}
          floating={undefined}
          focused={false}
          onNavigate={() => undefined}
          onReach={() => undefined}
          onScreen
          src="https://example.com"
        />,
      );
      expect(calls).toStrictEqual([]);
    });
  });

  // A CLICK ANYWHERE IN THE WINDOW IS THE USER STARTING TO WORK IN IT, and the
  // two halves of the window say so differently. The chrome sends a pointer
  // event this document can see. The page inside sends none at all — the view
  // hosts a browsing context of its own and the guest keeps them — so what
  // comes back from there is the focus the click took.
  describe("reaching the window", () => {
    // THE ONE THE ENGINE ACTUALLY SENDS. A guest takes focus at the moment the
    // embedder's page loses it, and `Document::SetFocusedElement` dispatches
    // `focus` and `focusin` only while the page is focused — so the element
    // becomes `activeElement` and no focus event is dispatched at all. The
    // fork's element says so in an event of its own instead; this is the
    // window hearing it.
    it("reports a reach when the guest in the page takes focus", async () => {
      await new Promise<void>((resolve) => {
        const { container } = render(
          <BrowserWindow
            clickThrough={false}
            domicile={silentDomicile}
            dragging={false}
            floating={undefined}
            focused={false}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            onScreen
            src="https://example.com"
          />,
        );
        view(container).dispatchEvent(new Event(WEBVIEW_GUEST_FOCUS_EVENT));
      });
    });

    it("reports a reach when focus lands in the page", async () => {
      await new Promise<void>((resolve) => {
        const { container } = render(
          <BrowserWindow
            clickThrough={false}
            domicile={silentDomicile}
            dragging={false}
            floating={undefined}
            focused={false}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            onScreen
            src="https://example.com"
          />,
        );
        fireEvent.focusIn(view(container));
      });
    });

    it("reports a reach when the chrome around the page is clicked", async () => {
      // Pressed where nothing takes the focus — the bar behind the controls —
      // so the pointer is the only thing that could have said this. A window
      // is reached by being clicked, not by having something in it focused.
      await new Promise<void>((resolve) => {
        render(
          <BrowserWindow
            clickThrough={false}
            domicile={silentDomicile}
            dragging={false}
            floating={undefined}
            focused={false}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            onScreen
            src="https://example.com"
          />,
        );
        fireEvent.pointerDown(browser());
      });
    });

    it("says nothing when the shell put the focus there itself", () => {
      // The window the user is already working in has nothing to report: the
      // focus in its page is the focus this window was given for being the one
      // they are in, and answering it would ask the shell to reach a window it
      // has just reached.
      const reaches: string[] = [];
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          domicile={silentDomicile}
          dragging={false}
          floating={undefined}
          focused
          onNavigate={() => undefined}
          onReach={() => {
            reaches.push("reach");
          }}
          onScreen
          src="https://example.com"
        />,
      );
      fireEvent.focusIn(view(container));
      expect(reaches).toStrictEqual([]);
    });
  });

  it("hides the window when it is not on the stage", () => {
    render(
      <BrowserWindow
        clickThrough={false}
        domicile={silentDomicile}
        dragging={false}
        floating={undefined}
        focused={false}
        onNavigate={() => undefined}
        onReach={() => undefined}
        onScreen={false}
        src="https://example.com"
      />,
    );
    // A hidden element is out of the accessibility tree, so it has no
    // accessible name left to match on — being the only region is enough.
    expect(screen.getByRole("region", { hidden: true })).not.toBeVisible();
  });
});
