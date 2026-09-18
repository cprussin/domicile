import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import {
  WEBVIEW_GUEST_FOCUS_EVENT,
  WEBVIEW_HISTORY_CHANGE_EVENT,
  WEBVIEW_LOADING_CHANGE_EVENT,
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

const noHover = () => {
  // Nothing in the case moves the pointer into the window.
};

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

/**
 * The engine starting or finishing a load in the guest and saying so, which
 * is the only way a chrome hears about one: the property is the state and the
 * event carries nothing.
 */
const loads = (element: HTMLWebViewElement, loading: boolean): void => {
  Object.defineProperty(element, "loading", {
    configurable: true,
    value: loading,
  });
  fireEvent(element, new Event(WEBVIEW_LOADING_CHANGE_EVENT));
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

/** Where a window on screen is, which no case here is about. */
const ON_SCREEN = { height: 800, width: 1200, x: 0, y: 32 };

describe("BrowserWindow", () => {
  it("points its view at the address it opened with", () => {
    const { container } = render(
      <BrowserWindow
        clickThrough={false}
        depth={0}
        domicile={silentDomicile}
        dragging={false}
        focused
        onHover={noHover}
        onNavigate={() => undefined}
        onReach={() => undefined}
        rect={ON_SCREEN}
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
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => undefined}
          rect={ON_SCREEN}
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
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={(url) => {
            seen.push(url);
          }}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      await userEvent.clear(address());
      await userEvent.type(address(), "docs.example.com{Enter}");
      expect(seen).toStrictEqual(["https://docs.example.com"]);
    });
  });

  describe("the page", () => {
    it("takes the whole window under the address bar", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => undefined}
          rect={ON_SCREEN}
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
          depth={0}
          domicile={recordingDomicile(calls)}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => undefined}
          rect={ON_SCREEN}
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
          depth={0}
          domicile={recordingDomicile(calls)}
          dragging={false}
          focused={false}
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      expect(calls).toStrictEqual([]);
    });

    // AND THE KEYBOARD IT TAKES IS ITS PAGE'S. Nothing else can put it there:
    // the page is a guest with a browsing context of its own, so the window
    // being worked in is what focuses it.
    it("puts the keyboard in its page when it becomes the window being worked in", () => {
      const windowProps = {
        clickThrough: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        onHover: noHover,
        onNavigate: () => undefined,
        onReach: () => undefined,
        rect: ON_SCREEN,
        src: "https://example.com",
      } as const;
      const { container, rerender } = render(
        <BrowserWindow {...windowProps} focused={false} />,
      );

      rerender(<BrowserWindow {...windowProps} focused />);

      expect(view(container)).toHaveFocus();
    });

    // EXCEPT WHEN THE KEYBOARD IS ALREADY IN THIS WINDOW, WHICH IS WHAT A
    // PRESS IN THE ADDRESS BAR PUTS IT THERE FOR. A press on the chrome is a
    // reach like any other — it is what makes this the window being worked in
    // — so the effect above runs on the focus that same press just took. A
    // window that focused its page there would spend the user's click on the
    // bar: the caret lands in the address bar and is taken out of it a moment
    // later, which is an address bar that cannot be typed into at all.
    it("leaves the focus in its address bar when the press that reached it landed there", async () => {
      const windowProps = {
        clickThrough: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        onHover: noHover,
        onNavigate: () => undefined,
        onReach: () => undefined,
        rect: ON_SCREEN,
        src: "https://example.com",
      } as const;
      const { rerender } = render(
        <BrowserWindow {...windowProps} focused={false} />,
      );
      await userEvent.click(address());

      // What the desktop does with that reach: this is the active window now.
      rerender(<BrowserWindow {...windowProps} focused />);

      expect(address()).toHaveFocus();
    });

    // AND IT GIVES THE KEYBOARD BACK, WHICH NOTHING ELSE CAN DO FOR IT. Every
    // key the desktop delivers arrives in this document first — the SDK
    // forwards it to whichever client the shell named — and a key pressed
    // while a guest holds the page's focus never arrives at all: it is
    // delivered inside a browsing context of its own and the document around
    // it hears nothing. The compositor moving the seat to a client does not
    // touch that. So a browser window that kept the focus after the user moved
    // on is a desktop where no window can be typed into, which is what
    // `focusChrome` cannot fix on its own.
    it("gives the keyboard back when the user moves to another window", () => {
      const windowProps = {
        clickThrough: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        onHover: noHover,
        onNavigate: () => undefined,
        onReach: () => undefined,
        rect: ON_SCREEN,
        src: "https://example.com",
      } as const;
      const { container, rerender } = render(
        <BrowserWindow {...windowProps} focused />,
      );
      expect(view(container)).toHaveFocus();

      rerender(<BrowserWindow {...windowProps} focused={false} />);

      expect(view(container)).not.toHaveFocus();
    });

    // The same rule, and the other half of the window: what the user left is
    // not where the caret stays. The desktop still types — a press in the
    // chrome does reach this document, and the SDK sends it on to whichever
    // client holds the keyboard — so what a window that kept the caret shows
    // is a bar that looks ready and swallows nothing.
    it("gives it back from its address bar too", async () => {
      const windowProps = {
        clickThrough: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        onHover: noHover,
        onNavigate: () => undefined,
        onReach: () => undefined,
        rect: ON_SCREEN,
        src: "https://example.com",
      } as const;
      const { rerender } = render(<BrowserWindow {...windowProps} focused />);
      await userEvent.click(address());

      rerender(<BrowserWindow {...windowProps} focused={false} />);

      expect(address()).not.toHaveFocus();
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
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused={false}
            onHover={noHover}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            rect={ON_SCREEN}
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
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused={false}
            onHover={noHover}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            rect={ON_SCREEN}
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
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused={false}
            onHover={noHover}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            rect={ON_SCREEN}
            src="https://example.com"
          />,
        );
        fireEvent.pointerDown(browser());
      });
    });

    it("reports a click in the page of the window it is already in", async () => {
      // Focus follows the cursor here, so the window under the pointer is the
      // one being worked in before the click lands — and a click in the page
      // is the only thing that can raise a window whose page the user is
      // already typing into. A window that answered only the reaches which
      // found it inactive would sit under whatever was covering it.
      await new Promise<void>((resolve) => {
        const { container } = render(
          <BrowserWindow
            clickThrough={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused
            onHover={noHover}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            rect={ON_SCREEN}
            src="https://example.com"
          />,
        );
        view(container).dispatchEvent(new Event(WEBVIEW_GUEST_FOCUS_EVENT));
      });
    });

    it("reports a click on the chrome of the window it is already in", async () => {
      // The other half of the same window, and the same rule.
      await new Promise<void>((resolve) => {
        render(
          <BrowserWindow
            clickThrough={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused
            onHover={noHover}
            onNavigate={() => undefined}
            onReach={() => {
              resolve();
            }}
            rect={ON_SCREEN}
            src="https://example.com"
          />,
        );
        fireEvent.pointerDown(browser());
      });
    });

    it("says nothing when the shell put the focus there itself", () => {
      // The focus this window gives its own page is announced exactly the way
      // a click there is: the element says so from inside `focus()`, whichever
      // route the focus came by. So the window spends the announcement it
      // caused — without it, the pointer arriving over a window would raise it
      // as well as focus it, and crossing the desktop would restack it.
      const reaches: string[] = [];
      const windowProps = {
        clickThrough: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        onHover: noHover,
        onNavigate: () => undefined,
        onReach: () => {
          reaches.push("reach");
        },
        rect: ON_SCREEN,
        src: "https://example.com",
      } as const;
      const { container, rerender } = render(
        <BrowserWindow {...windowProps} focused={false} />,
      );
      // The engine's own half, which happy-dom's element cannot carry: the
      // announcement comes out of the call that focuses the element.
      const guest = view(container);
      guest.addEventListener("focus", () => {
        guest.dispatchEvent(new Event(WEBVIEW_GUEST_FOCUS_EVENT));
      });

      rerender(<BrowserWindow {...windowProps} focused />);

      expect(reaches).toStrictEqual([]);
    });

    it("says nothing when it takes the focus back from nothing", async () => {
      // The keyboard this window puts back in its own page when the chrome
      // drops the focus — closing another window is the case
      // `useReclaimFocus` exists for — is the shell's focus as much as the one
      // a window is given for becoming active, and comes back as the same
      // announcement. Left unspent, closing a window would raise whatever window
      // the pointer last crossed.
      const reaches: string[] = [];
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => {
            reaches.push("reach");
          }}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      const guest = view(container);
      guest.addEventListener("focus", () => {
        guest.dispatchEvent(new Event(WEBVIEW_GUEST_FOCUS_EVENT));
      });
      // Something of the chrome takes the focus and then leaves it on nothing,
      // which is what an element unmounted mid-press does.
      const pressed = document.createElement("button");
      document.body.append(pressed);
      pressed.focus();

      await act(() => {
        pressed.blur();
        return Promise.resolve();
      });
      pressed.remove();

      expect(reaches).toStrictEqual([]);
    });

    it("reports the window the pointer moves into", async () => {
      // Focus follows the cursor, and a browser window hears the pointer
      // arrive the way any other chrome does.
      await new Promise<void>((resolve) => {
        render(
          <BrowserWindow
            clickThrough={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused={false}
            onHover={() => {
              resolve();
            }}
            onNavigate={() => undefined}
            onReach={() => undefined}
            rect={ON_SCREEN}
            src="https://example.com"
          />,
        );
        fireEvent.pointerOver(browser());
      });
    });
  });

  // A CONTROL THAT WOULD DO NOTHING SAYS SO BEFORE IT IS PRESSED. `goBack()`
  // on a history with nothing behind it is a no-op in the browser process, so
  // a live-looking button is the window telling the user something it cannot
  // do.
  describe("the history controls", () => {
    it("grays Back out until the page has somewhere to go back to", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => undefined}
          rect={ON_SCREEN}
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

    it("grays Forward out until the page has somewhere to go forward to", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      expect(control("Forward")).toBeDisabled();
      historyReaches(view(container), false, true);
      expect(control("Forward")).not.toBeDisabled();
      expect(control("Back")).toBeDisabled();
    });
  });

  describe("the loading state", () => {
    it("says the page is arriving until it has arrived", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          onHover={noHover}
          onNavigate={() => undefined}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      // A window whose guest has said nothing is a window with nothing on the
      // way: the element answers false until the browser says otherwise.
      expect(screen.queryByRole("img", { name: "Loading" })).toBeNull();
      loads(view(container), true);
      expect(screen.getByRole("img", { name: "Loading" })).toBeVisible();
      loads(view(container), false);
      expect(screen.queryByRole("img", { name: "Loading" })).toBeNull();
    });
  });

  it("hides the window when it is not on screen", () => {
    render(
      <BrowserWindow
        clickThrough={false}
        depth={0}
        domicile={silentDomicile}
        dragging={false}
        focused={false}
        onHover={noHover}
        onNavigate={() => undefined}
        onReach={() => undefined}
        rect={undefined}
        src="https://example.com"
      />,
    );
    // A hidden element is out of the accessibility tree, so it has no
    // accessible name left to match on — being the only region is enough.
    expect(screen.getByRole("region", { hidden: true })).not.toBeVisible();
  });

  describe("the way it arrives and settles", () => {
    /** The props every case here shares; each overrides the one it is about. */
    const windowProps = {
      clickThrough: false,
      depth: 0,
      domicile: silentDomicile,
      dragging: false,
      focused: false,
      onHover: noHover,
      onNavigate: () => undefined,
      onReach: () => undefined,
      rect: ON_SCREEN,
      src: "https://example.com",
    } as const;

    it("grows into its box as it arrives", () => {
      render(<BrowserWindow {...windowProps} />);

      expect(globalThis.getComputedStyle(browser()).animation).toContain(
        "windowOpening",
      );
    });

    it("eases to a new box rather than jumping to it", () => {
      render(<BrowserWindow {...windowProps} />);

      expect(globalThis.getComputedStyle(browser()).transition).toContain(
        "inline-size",
      );
    });

    it("follows the pointer exactly while it is being dragged", () => {
      // A drag writes a new box on every pointer move, and a window easing
      // towards each of them trails the pointer instead of following it.
      render(<BrowserWindow {...windowProps} dragging />);

      expect(globalThis.getComputedStyle(browser()).transition).not.toContain(
        "inline-size",
      );
    });
  });
});
