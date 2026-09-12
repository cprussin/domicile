import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import {
  WEBVIEW_GUEST_FOCUS_EVENT,
  WEBVIEW_HISTORY_CHANGE_EVENT,
} from "@domicile/chrome-sdk/webview-element";
import { fireEvent, render, screen } from "@testing-library/react";
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

const view = (container: HTMLElement): HTMLWebViewElement => {
  const element = container.querySelector("webview");
  if (element === null) {
    throw new Error("test: the browser window rendered no view");
  } else {
    return element;
  }
};

const address = (): HTMLInputElement =>
  screen.getByRole("textbox", { name: "Address" });

const browser = (): HTMLElement =>
  screen.getByRole("region", { name: "Browser" });

const control = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

/**
 * The engine moving the guest's history and saying so, which is the only way a
 * chrome hears about one: the properties are the state and the event carries
 * nothing.
 *
 * `defineProperties` rather than assignment because they are readonly on the
 * real element — where the guest can go is the browser process's to say.
 */
const historyReaches = (
  element: HTMLWebViewElement,
  canGoBack: boolean,
  canGoForward: boolean,
): void => {
  Object.defineProperties(element, {
    canGoBack: { configurable: true, value: canGoBack },
    canGoForward: { configurable: true, value: canGoForward },
  });
  fireEvent(element, new Event(WEBVIEW_HISTORY_CHANGE_EVENT));
};

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

    // WHERE THE SHELL SENT IT, which is every navigation the shell can see. A
    // page that follows a link or a redirect goes somewhere this window is
    // never told about: the guest's page is the browser process's, and the
    // engine reports its history availability but not its address.
    it("reports where it sent the page so the window's tab can be retitled", async () => {
      const seen: string[] = [];
      render(
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
      await userEvent.clear(address());
      await userEvent.type(address(), "docs.example.com{Enter}");
      expect(seen).toStrictEqual(["https://docs.example.com"]);
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
      // ...and the view takes it, which it has to be told to do: a `<webview>`
      // is a replaced element and an unstretched one is 300x150 whatever it is
      // put inside.
      expect(globalThis.getComputedStyle(view(container)).flexGrow).toBe("1");
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

  // A CONTROL THAT WOULD DO NOTHING SAYS SO BEFORE IT IS PRESSED. `goBack()`
  // on a history with nothing behind it is a no-op in the browser process, so
  // a live-looking button is the window telling the user something it cannot
  // do.
  describe("the history controls", () => {
    it("greys Back out until the page has somewhere to go back to", () => {
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
      expect(control("Back")).toBeDisabled();
      historyReaches(view(container), true, false);
      expect(control("Back")).not.toBeDisabled();
      // Its own property, not the other one: a page that has been back once
      // can go back again without being able to go forward.
      expect(control("Forward")).toBeDisabled();
    });

    it("greys Forward out until the page has somewhere to go forward to", () => {
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
      expect(control("Forward")).toBeDisabled();
      historyReaches(view(container), false, true);
      expect(control("Forward")).not.toBeDisabled();
      expect(control("Back")).toBeDisabled();
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
