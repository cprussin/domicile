import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { focusApp } from "@domicile/chrome-sdk/focus-app";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import {
  WEBVIEW_CLOSE_EVENT,
  WEBVIEW_FILE_CHOOSER_EVENT,
  WEBVIEW_FIND_CHANGE_EVENT,
  WEBVIEW_FOCUS_REQUEST_EVENT,
  WEBVIEW_GUEST_FOCUS_EVENT,
  WEBVIEW_GUEST_KEYDOWN_EVENT,
  WEBVIEW_HISTORY_CHANGE_EVENT,
  WEBVIEW_LOADING_CHANGE_EVENT,
  WEBVIEW_NEW_WINDOW_EVENT,
  WEBVIEW_PAGE_CHANGE_EVENT,
  WEBVIEW_ZOOM_CHANGE_EVENT,
  WEBVIEW_ZOOM_OUT_REQUEST_EVENT,
} from "@domicile/chrome-sdk/webview-element";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../../styled-system/css";
import { loadEmittedStylesheet } from "../emitted-stylesheet";
import { BrowserWindow } from "./BrowserWindow";

const silentDomicile = {
  focusApp: () => undefined,
  focusChrome: () => undefined,
} as unknown as DomicileClient;

/** A domicile client that keeps what the window told the host, in order. */
const recordingDomicile = (calls: string[]): DomicileClient =>
  ({
    ...silentDomicile,
    focusChrome: () => {
      calls.push("focusChrome");
    },
  }) as unknown as DomicileClient;

const noWindows = () => {
  // Nothing in the case asks for a window of its own.
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
  screen.getByRole("combobox", { name: "Address" });

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

/**
 * The engine saying the page inside the view asked for a window of its own —
 * a `target="_blank"` link followed, a `window.open` called.
 *
 * The one `<webview>` event that carries anything, and it has to: there is no
 * second view to read the address off yet, which is the whole of what the page
 * is asking for. Built rather than constructed, because the event's own type is
 * the engine's and no DOM this test runs on has it.
 */
const asksForAWindow = (element: HTMLWebViewElement, url: string): void => {
  fireEvent(
    element,
    Object.assign(new Event(WEBVIEW_NEW_WINDOW_EVENT), { url }),
  );
};

/**
 * The engine saying the page inside the view is waiting on a file, with every
 * answer the window gives it kept in order. Built rather than constructed, like
 * the new window's, and cancelable because taking it is `preventDefault()`.
 */
const asksForAFile = (element: HTMLWebViewElement, answers: string[]): void => {
  fireEvent(
    element,
    Object.assign(new Event(WEBVIEW_FILE_CHOOSER_EVENT, { cancelable: true }), {
      accept: [],
      cancel: () => {
        answers.push("cancel");
      },
      choose: (paths: readonly string[]) => {
        answers.push(`choose ${paths.join(",")}`);
      },
      home: "/home/someone",
      // A home with one file in it, which is all a picker here is asked about.
      list: () => Promise.resolve(["notes.txt"]),
      mode: "open",
      suggestedName: "",
    }),
  );
};

/** The picker's box, which is where its keyboard is. */
const pickerBox = (): HTMLElement =>
  screen.getByRole("combobox", { name: "Filter or go to a path" });

/**
 * The engine reporting where the guest now is and what it says about the
 * connection behind it — a page committing, a link followed, a certificate
 * going bad under a page that never moved.
 *
 * `defineProperties` rather than assignment because both are readonly on the
 * real element: where the page is and what the connection is worth are the
 * browser process's to say.
 */
const shows = (
  element: HTMLWebViewElement,
  url: string,
  security: string,
): void => {
  Object.defineProperties(element, {
    security: { configurable: true, value: security },
    url: { configurable: true, value: url },
  });
  fireEvent(element, new Event(WEBVIEW_PAGE_CHANGE_EVENT));
};

/**
 * A view whose zoom works the way the engine's does: `setZoom` is a request,
 * and the answer arrives on the element with the event that says to read it.
 * Every factor asked for is kept, in order.
 */
const zoomable = (element: HTMLWebViewElement, factor: number): number[] => {
  const asked: number[] = [];
  const answer = (next: number) => {
    Object.defineProperty(element, "zoom", { configurable: true, value: next });
    fireEvent(element, new Event(WEBVIEW_ZOOM_CHANGE_EVENT));
  };
  element.setZoom = (next: number) => {
    asked.push(next);
    answer(next);
  };
  answer(factor);
  return asked;
};

/**
 * A chord the page in the view left alone, handed back by the engine. A
 * `KeyboardEvent` of the engine's own type, because that is what arrives.
 */
const guestPresses = (
  element: HTMLWebViewElement,
  init: KeyboardEventInit,
): void => {
  fireEvent(
    element,
    new KeyboardEvent(WEBVIEW_GUEST_KEYDOWN_EVENT, { bubbles: true, ...init }),
  );
};

/**
 * A view whose find says what it was asked to do, in order, the way the
 * engine's `find` and `stopFinding` would be called — and that has found
 * nothing yet, which is where the engine's element starts.
 */
const findable = (element: HTMLWebViewElement): string[] => {
  const calls: string[] = [];
  finds(element, 0, 0);
  element.find = (text: string, backward = false) => {
    calls.push(backward ? `find ${text} backward` : `find ${text}`);
  };
  element.stopFinding = () => {
    calls.push("stop");
  };
  return calls;
};

/**
 * The engine reporting what a find has found. `defineProperties` because both
 * are readonly on the real element: the count is the browser's.
 */
const finds = (
  element: HTMLWebViewElement,
  matches: number,
  activeMatch: number,
): void => {
  Object.defineProperties(element, {
    findActiveMatch: { configurable: true, value: activeMatch },
    findMatches: { configurable: true, value: matches },
  });
  fireEvent(element, new Event(WEBVIEW_FIND_CHANGE_EVENT));
};

/** The find bar's box, which is where its keyboard is. */
const findBox = (): HTMLElement =>
  screen.getByRole("searchbox", { name: "Find in page" });

loadEmittedStylesheet(document);

/** Where a window on screen is, which no case here is about. */
const ON_SCREEN = { height: 800, width: 1200, x: 0, y: 32 };

/** The whole box its bar and its contents span, which it turns about. */
const FRAME = { height: 830, width: 1200, x: 0, y: 2 };

const nothingEnded = () => {
  // Nothing in the case plays an animation to its end.
};

const nothingClosed = () => {
  // Nothing in the case asks for the window to close.
};

describe("BrowserWindow", () => {
  it("rounds its bottom corners, and clips the page to them", () => {
    render(
      <BrowserWindow
        clickThrough={false}
        covered={false}
        depth={0}
        domicile={silentDomicile}
        dragging={false}
        focused
        frame={FRAME}
        fullscreen={false}
        motion="resting"
        onClose={nothingClosed}
        onMotionEnded={nothingEnded}
        onNavigate={() => undefined}
        onOpenWindow={noWindows}
        onReach={() => undefined}
        rect={ON_SCREEN}
        src="https://example.com"
      />,
    );
    const style = globalThis.getComputedStyle(browser());

    expect(style.borderEndStartRadius).not.toBe("");
    expect(style.borderEndEndRadius).not.toBe("");
    // A radius clips the page in the view only if its overflow is clipped.
    expect(style.overflow).toBe("hidden");
  });

  it("squares its corners and drops its edge while it fills the screen", () => {
    render(
      <BrowserWindow
        clickThrough={false}
        covered={false}
        depth={0}
        domicile={silentDomicile}
        dragging={false}
        focused
        frame={FRAME}
        fullscreen
        motion="resting"
        onClose={nothingClosed}
        onMotionEnded={nothingEnded}
        onNavigate={() => undefined}
        onOpenWindow={noWindows}
        onReach={() => undefined}
        rect={ON_SCREEN}
        src="https://example.com"
      />,
    );
    const style = globalThis.getComputedStyle(browser());

    expect(style.borderEndStartRadius).toBe("");
    expect(style.borderEndEndRadius).toBe("");
    // A line around the edge of the screen says nothing the window does not.
    expect(style.borderTopWidth).not.toBe("1px");
  });

  it("leaves its frame the resting color while it is all the screen shows", () => {
    // Focused, but with nothing else on the screen to be picked out from.
    render(
      <BrowserWindow
        alone
        clickThrough={false}
        covered={false}
        depth={0}
        domicile={silentDomicile}
        dragging={false}
        focused
        frame={FRAME}
        fullscreen={false}
        motion="resting"
        onClose={nothingClosed}
        onMotionEnded={nothingEnded}
        onNavigate={() => undefined}
        onOpenWindow={noWindows}
        onReach={() => undefined}
        rect={ON_SCREEN}
        src="https://example.com"
      />,
    );

    expect(browser().className).toContain(css({ borderColor: "borderStrong" }));
  });

  it("points its view at the address it opened with", () => {
    const { container } = render(
      <BrowserWindow
        clickThrough={false}
        covered={false}
        depth={0}
        domicile={silentDomicile}
        dragging={false}
        focused
        frame={FRAME}
        fullscreen={false}
        motion="resting"
        onClose={nothingClosed}
        onMotionEnded={nothingEnded}
        onNavigate={() => undefined}
        onOpenWindow={noWindows}
        onReach={() => undefined}
        rect={ON_SCREEN}
        src="https://example.com"
      />,
    );
    expect(view(container).getAttribute("src")).toBe("https://example.com");
    expect(address()).toHaveValue("https://example.com");
  });

  describe("the address bar", () => {
    it("sends the view to what was typed, filling in a missing scheme", async () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
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

    // WHERE THE PAGE WENT, which is not where it was sent — and the difference
    // is the whole of what the engine's page report bought. A window named
    // after the shell's last ask wears the name of the page the user left, the
    // moment they follow a link.
    it("reports where the page went, so the window's tab follows it", () => {
      const seen: string[] = [];
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={(url) => {
            seen.push(url);
          }}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );

      shows(view(container), "https://elsewhere.example/landing", "secure");

      expect(seen).toStrictEqual(["https://elsewhere.example/landing"]);
    });

    // ONE REPORT PER PAGE, AND THE CALLBACK'S IDENTITY IS NOT A PAGE. The
    // desktop hands this window a fresh arrow on every render — `Stage.tsx`
    // builds one inline — so an effect keyed on the callback alone re-reports
    // the page it already reported, the desktop renames the window, that
    // renders the window again, and the loop does not stop.
    it("reports a page once, however often it is re-rendered", () => {
      const seen: string[] = [];
      const windowProps = {
        clickThrough: false,
        covered: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        focused: true,
        frame: FRAME,
        fullscreen: false,
        motion: "resting",
        onClose: nothingClosed,
        onMotionEnded: nothingEnded,
        onOpenWindow: noWindows,
        onReach: () => undefined,
        rect: ON_SCREEN,
        src: "https://example.com",
      } as const;
      const report = () => (url: string) => {
        seen.push(url);
      };
      const { container, rerender } = render(
        <BrowserWindow {...windowProps} onNavigate={report()} />,
      );

      shows(view(container), "https://elsewhere.example/landing", "secure");
      // A fresh callback, which is what every render of the desktop hands it.
      rerender(<BrowserWindow {...windowProps} onNavigate={report()} />);
      rerender(<BrowserWindow {...windowProps} onNavigate={report()} />);

      expect(seen).toStrictEqual(["https://elsewhere.example/landing"]);
    });

    // AND THE BAR FOLLOWS IT TOO. The shell sent this window to one place and
    // the page went to another by itself; what the user reads has to be the
    // second, or the address bar is describing a page that is not on screen.
    it("shows where the page went rather than where it was sent", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      expect(address()).toHaveValue("https://example.com");

      shows(view(container), "https://elsewhere.example/landing", "warning");

      expect(address()).toHaveValue("https://elsewhere.example/landing");
    });

    // AND SO DOES THE LOCK. This is the reading that used to come off the URL
    // scheme, which answered "secure" for an expired certificate and for a
    // page running active mixed content alike.
    it("draws the browser's verdict on the page, not a guess from its scheme", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      // Nothing reported yet: a window whose guest has committed no page has no
      // verdict to draw, and must not invent one.
      expect(control("Connection is not known")).toBeVisible();

      shows(view(container), "https://expired.example.com", "dangerous");

      expect(control("Connection is not private")).toBeVisible();
    });
  });

  // A LINK WITH `target="_blank"`, which without this does nothing at all. The
  // page in the window is a guest, so the browser process refuses the window it
  // asks for and reports the address instead — a window is the desktop's to
  // open, and this window is not the one to open it.
  describe("a window its page asks for", () => {
    it("asks the desktop for the address the page wanted", async () => {
      const wanted = await new Promise<string>((resolve) => {
        const { container } = render(
          <BrowserWindow
            clickThrough={false}
            covered={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused
            frame={FRAME}
            fullscreen={false}
            motion="resting"
            onClose={nothingClosed}
            onMotionEnded={nothingEnded}
            onNavigate={() => undefined}
            onOpenWindow={resolve}
            onReach={() => undefined}
            rect={ON_SCREEN}
            src="https://example.com"
          />,
        );
        asksForAWindow(view(container), "https://example.com/opened");
      });
      expect(wanted).toBe("https://example.com/opened");
    });
  });

  // `window.close()` in the page, or `chrome.tabs.remove` from an extension:
  // the engine closes nothing and asks, and the window is the desktop's to
  // close. See `WEBVIEW_CLOSE_EVENT`.
  describe("a close its page asks for", () => {
    it("asks the desktop to close the window", async () => {
      await new Promise<void>((resolve) => {
        const { container } = render(
          <BrowserWindow
            clickThrough={false}
            covered={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused
            frame={FRAME}
            fullscreen={false}
            motion="resting"
            onClose={resolve}
            onMotionEnded={nothingEnded}
            onNavigate={() => undefined}
            onOpenWindow={noWindows}
            onReach={() => undefined}
            rect={ON_SCREEN}
            src="https://example.com"
          />,
        );
        view(container).dispatchEvent(new Event(WEBVIEW_CLOSE_EVENT));
      });
    });
  });

  // A PAGE WAITING ON A FILE IS WAITING ON THIS WINDOW. The engine draws no
  // dialog of its own and cancels a question nobody takes, so the picker is
  // this window's to draw — over its page, holding its keyboard, until it is
  // answered.
  describe("a file its page asks for", () => {
    const windowProps = {
      clickThrough: false,
      covered: false,
      depth: 0,
      domicile: silentDomicile,
      dragging: false,
      frame: FRAME,
      fullscreen: false,
      motion: "resting",
      onClose: nothingClosed,
      onMotionEnded: nothingEnded,
      onNavigate: () => undefined,
      onOpenWindow: noWindows,
      onReach: () => undefined,
      rect: ON_SCREEN,
      src: "https://example.com",
    } as const;

    it("answers the page with what is picked, and puts the picker away", async () => {
      const answers: string[] = [];
      const { container } = render(<BrowserWindow {...windowProps} focused />);
      asksForAFile(view(container), answers);

      await userEvent.dblClick(
        await screen.findByRole("option", { name: "notes.txt" }),
      );

      expect(answers).toStrictEqual(["choose /home/someone/notes.txt"]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("puts the keyboard in the picker rather than the page", async () => {
      const { container } = render(<BrowserWindow {...windowProps} focused />);

      asksForAFile(view(container), []);
      await screen.findByRole("option", { name: "notes.txt" });

      expect(pickerBox()).toHaveFocus();
    });

    // The focus it gives its picker is its own, like the focus it gives its
    // page, and not the user reaching for the window.
    it("says nothing when it puts the keyboard in its picker", async () => {
      const reaches: string[] = [];
      const { container } = render(
        <BrowserWindow
          {...windowProps}
          focused
          onReach={() => {
            reaches.push("reach");
          }}
        />,
      );

      asksForAFile(view(container), []);
      await screen.findByRole("option", { name: "notes.txt" });

      expect(reaches).toStrictEqual([]);
    });

    // The window's keyboard is the picker's for as long as it is up, so a
    // window the user comes back to hands it there and not to a page that is
    // waiting on it.
    it("hands the keyboard back to the picker when the window is reached again", async () => {
      const { container, rerender } = render(
        <BrowserWindow {...windowProps} focused />,
      );
      asksForAFile(view(container), []);
      await screen.findByRole("option", { name: "notes.txt" });

      rerender(<BrowserWindow {...windowProps} focused={false} />);
      expect(pickerBox()).not.toHaveFocus();
      rerender(<BrowserWindow {...windowProps} focused />);

      expect(pickerBox()).toHaveFocus();
    });

    // The newer question replaces the older — see `useFileRequest` — and is
    // a question of its own, not the rest of the last one's typing.
    it("starts afresh on a second question", async () => {
      const answers: string[] = [];
      const { container } = render(<BrowserWindow {...windowProps} focused />);
      asksForAFile(view(container), answers);
      await userEvent.type(pickerBox(), "notes");

      asksForAFile(view(container), answers);

      expect(answers).toStrictEqual(["cancel"]);
      expect(pickerBox()).toHaveValue("");
      await screen.findByRole("option", { name: "notes.txt" });
    });

    it("gives the page its keyboard back once the question is answered", async () => {
      const answers: string[] = [];
      const { container } = render(<BrowserWindow {...windowProps} focused />);
      asksForAFile(view(container), answers);
      await screen.findByRole("option", { name: "notes.txt" });

      await userEvent.type(pickerBox(), "{Escape}");

      expect(answers).toStrictEqual(["cancel"]);
      expect(view(container)).toHaveFocus();
    });
  });

  describe("the page", () => {
    it("takes the whole window under the address bar", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
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
          covered={false}
          depth={0}
          domicile={recordingDomicile(calls)}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
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
          covered={false}
          depth={0}
          domicile={recordingDomicile(calls)}
          dragging={false}
          focused={false}
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      expect(calls).toStrictEqual([]);
    });

    // AND THE PAGE STOPS FORWARDING KEYS TO THE CLIENT IT LEFT. The SDK sends
    // every key this document hears to the client it last routed the keyboard
    // to, and moving the seat does not change that — so a window that moved
    // only the seat left the terminal before it named there. Nothing showed
    // while the guest had the focus, because the document hears none of its
    // keys; the launcher's box was where it showed, empty under every letter.
    it("stops the page forwarding its keys to the client it took the keyboard from", () => {
      const forwarded: string[] = [];
      const domicile = {
        ...silentDomicile,
        key: (appId: string) => {
          forwarded.push(appId);
        },
      } as unknown as DomicileClient;
      registerElements(domicile);
      render(<app app-id="term" />);
      focusApp(domicile, "term");

      render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={domicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      fireEvent.keyDown(document, { code: "KeyA" });

      expect(forwarded).toStrictEqual([]);
    });

    // AND THE KEYBOARD IT TAKES IS ITS PAGE'S. Nothing else can put it there:
    // the page is a guest with a browsing context of its own, so the window
    // being worked in is what focuses it.
    it("puts the keyboard in its page when it becomes the window being worked in", () => {
      const windowProps = {
        clickThrough: false,
        covered: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        frame: FRAME,
        fullscreen: false,
        motion: "resting",
        onClose: nothingClosed,
        onMotionEnded: nothingEnded,
        onNavigate: () => undefined,
        onOpenWindow: noWindows,
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
        covered: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        frame: FRAME,
        fullscreen: false,
        motion: "resting",
        onClose: nothingClosed,
        onMotionEnded: nothingEnded,
        onNavigate: () => undefined,
        onOpenWindow: noWindows,
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
        covered: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        frame: FRAME,
        fullscreen: false,
        motion: "resting",
        onClose: nothingClosed,
        onMotionEnded: nothingEnded,
        onNavigate: () => undefined,
        onOpenWindow: noWindows,
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
        covered: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        frame: FRAME,
        fullscreen: false,
        motion: "resting",
        onClose: nothingClosed,
        onMotionEnded: nothingEnded,
        onNavigate: () => undefined,
        onOpenWindow: noWindows,
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
            covered={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused={false}
            frame={FRAME}
            fullscreen={false}
            motion="resting"
            onClose={nothingClosed}
            onMotionEnded={nothingEnded}
            onNavigate={() => undefined}
            onOpenWindow={noWindows}
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
            covered={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused={false}
            frame={FRAME}
            fullscreen={false}
            motion="resting"
            onClose={nothingClosed}
            onMotionEnded={nothingEnded}
            onNavigate={() => undefined}
            onOpenWindow={noWindows}
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

    // A PAGE UNDER ANOTHER TAB TAKES FOCUS WITHOUT ANYONE REACHING FOR IT: the
    // engine hands the keyboard back to the guest that last had it. The engine
    // says so in a real `focusin` as well as its own event, and the window
    // answers neither.
    it("says nothing when the page under another tab takes focus", () => {
      const reaches: string[] = [];
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused={false}
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => {
            reaches.push("reach");
          }}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );

      fireEvent.focusIn(view(container));
      view(container).dispatchEvent(new Event(WEBVIEW_GUEST_FOCUS_EVENT));

      expect(reaches).toStrictEqual([]);
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
            covered={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused
            frame={FRAME}
            fullscreen={false}
            motion="resting"
            onClose={nothingClosed}
            onMotionEnded={nothingEnded}
            onNavigate={() => undefined}
            onOpenWindow={noWindows}
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

    it("reports a reach when an extension asks for the window in front", async () => {
      // `chrome.tabs.update(id, {active: true})` and `chrome.windows.update(id,
      // {focused: true})` arrive on the view, and raising a window is what a
      // reach does.
      await new Promise<void>((resolve) => {
        const { container } = render(
          <BrowserWindow
            clickThrough={false}
            covered={false}
            depth={0}
            domicile={silentDomicile}
            dragging={false}
            focused={false}
            frame={FRAME}
            fullscreen={false}
            motion="resting"
            onClose={nothingClosed}
            onMotionEnded={nothingEnded}
            onNavigate={() => undefined}
            onOpenWindow={noWindows}
            onReach={() => {
              resolve();
            }}
            rect={ON_SCREEN}
            src="https://example.com"
          />,
        );
        view(container).dispatchEvent(new Event(WEBVIEW_FOCUS_REQUEST_EVENT));
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
        covered: false,
        depth: 0,
        domicile: silentDomicile,
        dragging: false,
        frame: FRAME,
        fullscreen: false,
        motion: "resting",
        onClose: nothingClosed,
        onMotionEnded: nothingEnded,
        onNavigate: () => undefined,
        onOpenWindow: noWindows,
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
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
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
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
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
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
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

  // The bar's own behavior is `AddressBar`'s to test; what is this window's
  // is the wiring — the one control reads the view's loading state, and
  // whichever of the two it is drives the view.
  describe("the reload button", () => {
    it("becomes a stop button while the view says a page is arriving", () => {
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      // A window whose guest has said nothing is a window with nothing on the
      // way: the element answers false until the browser says otherwise.
      expect(control("Reload")).toBeVisible();
      loads(view(container), true);
      expect(control("Stop")).toBeVisible();
      loads(view(container), false);
      expect(control("Reload")).toBeVisible();
    });

    it("drives the view with whichever of the two it is", async () => {
      const driven: string[] = [];
      const { container } = render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );
      const guest = view(container);
      guest.reload = () => {
        driven.push("reload");
      };
      guest.stop = () => {
        driven.push("stop");
      };

      await userEvent.click(control("Reload"));
      loads(guest, true);
      await userEvent.click(control("Stop"));

      expect(driven).toStrictEqual(["reload", "stop"]);
    });
  });

  describe("a browser's keys", () => {
    const renderWindow = () =>
      render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );

    /** A view whose history controls say what they were asked to do. */
    const driven = (element: HTMLWebViewElement): string[] => {
      const calls: string[] = [];
      element.goBack = () => {
        calls.push("back");
      };
      element.goForward = () => {
        calls.push("forward");
      };
      element.reload = () => {
        calls.push("reload");
      };
      return calls;
    };

    // THE PAGE'S HALF OF THE WINDOW SENDS NO KEYS OUT, so this is the only
    // way a chord pressed there arrives: the engine hands back the ones the
    // page left alone.
    it("answers a chord the page left alone", () => {
      const { container } = renderWindow();
      const calls = driven(view(container));

      guestPresses(view(container), { altKey: true, key: "ArrowLeft" });
      guestPresses(view(container), { altKey: true, key: "ArrowRight" });
      guestPresses(view(container), { ctrlKey: true, key: "r" });

      expect(calls).toStrictEqual(["back", "forward", "reload"]);
    });

    it("answers the same chord pressed in its own address bar", () => {
      const { container } = renderWindow();
      const calls = driven(view(container));

      fireEvent.keyDown(address(), { ctrlKey: true, key: "R", shiftKey: true });

      expect(calls).toStrictEqual(["reload"]);
    });

    it("leaves a chord that is not a browser's alone", () => {
      const { container } = renderWindow();
      const calls = driven(view(container));
      const asked = zoomable(view(container), 1);

      guestPresses(view(container), { ctrlKey: true, key: "q" });

      expect(calls).toStrictEqual([]);
      expect(asked).toStrictEqual([]);
    });

    it("zooms a step from wherever the page is", () => {
      const { container } = renderWindow();
      const asked = zoomable(view(container), 1.25);

      guestPresses(view(container), { ctrlKey: true, key: "=" });
      guestPresses(view(container), { ctrlKey: true, key: "-" });
      guestPresses(view(container), { ctrlKey: true, key: "0" });

      expect(asked).toStrictEqual([1.5, 1.25, 1]);
    });

    // Ctrl and the wheel over the page, which the engine turns into a request
    // rather than a zoom, so it takes the same steps a key does.
    it("zooms when the wheel asks it to", () => {
      const { container } = renderWindow();
      const asked = zoomable(view(container), 1);

      fireEvent(view(container), new Event(WEBVIEW_ZOOM_OUT_REQUEST_EVENT));

      expect(asked).toStrictEqual([0.9]);
    });

    it("zooms from the buttons in its bar", async () => {
      const { container } = renderWindow();
      const asked = zoomable(view(container), 1);

      await userEvent.click(control("Zoom in"));

      expect(asked).toStrictEqual([1.1]);
    });

    it("says what it zoomed to", () => {
      const { container } = renderWindow();
      zoomable(view(container), 1);

      guestPresses(view(container), { ctrlKey: true, key: "+" });

      expect(screen.getByRole("status")).toHaveTextContent("110%");
    });
  });

  describe("finding in the page", () => {
    const renderWindow = () =>
      render(
        <BrowserWindow
          clickThrough={false}
          covered={false}
          depth={0}
          domicile={silentDomicile}
          dragging={false}
          focused
          frame={FRAME}
          fullscreen={false}
          motion="resting"
          onClose={nothingClosed}
          onMotionEnded={nothingEnded}
          onNavigate={() => undefined}
          onOpenWindow={noWindows}
          onReach={() => undefined}
          rect={ON_SCREEN}
          src="https://example.com"
        />,
      );

    // Ctrl+F pressed in the page, which the page left alone and the engine
    // handed back — the way a find bar is almost always opened.
    it("opens a find bar on Ctrl+F, with the keyboard in it", () => {
      const { container } = renderWindow();

      guestPresses(view(container), { ctrlKey: true, key: "f" });

      expect(findBox()).toHaveFocus();
    });

    // Chrome's Ctrl+F with the bar already up: back into the box, with what
    // it holds selected so the next thing typed replaces it.
    it("takes the keyboard back on Ctrl+F with the bar already up", async () => {
      const { container } = renderWindow();
      findable(view(container));
      guestPresses(view(container), { ctrlKey: true, key: "f" });
      await userEvent.type(findBox(), "ab");
      act(() => {
        view(container).focus();
      });

      guestPresses(view(container), { ctrlKey: true, key: "f" });

      expect(findBox()).toHaveFocus();
      expect(findBox()).toHaveProperty("selectionStart", 0);
      expect(findBox()).toHaveProperty("selectionEnd", 2);
    });

    it("finds as the user types, and steps with Enter and Shift+Enter", async () => {
      const { container } = renderWindow();
      const calls = findable(view(container));
      guestPresses(view(container), { ctrlKey: true, key: "f" });

      await userEvent.type(findBox(), "ab");
      await userEvent.keyboard("{Enter}{Shift>}{Enter}{/Shift}");

      expect(calls).toStrictEqual([
        "find a",
        "find ab",
        "find ab",
        "find ab backward",
      ]);
    });

    it("steps from its buttons", async () => {
      const { container } = renderWindow();
      const calls = findable(view(container));
      guestPresses(view(container), { ctrlKey: true, key: "f" });
      await userEvent.type(findBox(), "a");
      finds(view(container), 2, 1);

      await userEvent.click(control("Next match"));
      await userEvent.click(control("Previous match"));

      expect(calls).toStrictEqual(["find a", "find a", "find a backward"]);
    });

    it("says which match it is on, out of how many", async () => {
      const { container } = renderWindow();
      findable(view(container));
      guestPresses(view(container), { ctrlKey: true, key: "f" });
      await userEvent.type(findBox(), "a");

      finds(view(container), 3, 2);

      expect(screen.getByText("2/3")).toBeInTheDocument();
    });

    // Escape in a find bar, as in Chrome: the match it was on stays selected,
    // and the keyboard goes back to the page it was finding in.
    it("stops and hands the page back the keyboard on Escape", async () => {
      const { container } = renderWindow();
      const calls = findable(view(container));
      guestPresses(view(container), { ctrlKey: true, key: "f" });

      await userEvent.keyboard("{Escape}");

      expect(calls).toStrictEqual(["stop"]);
      expect(
        screen.queryByRole("searchbox", { name: "Find in page" }),
      ).toBeNull();
      expect(view(container)).toHaveFocus();
    });

    it("stops from its close button", async () => {
      const { container } = renderWindow();
      const calls = findable(view(container));
      guestPresses(view(container), { ctrlKey: true, key: "f" });

      await userEvent.click(control("Close find bar"));

      expect(calls).toStrictEqual(["stop"]);
      expect(
        screen.queryByRole("searchbox", { name: "Find in page" }),
      ).toBeNull();
    });
  });

  it("hides the window when it is not on screen", () => {
    render(
      <BrowserWindow
        clickThrough={false}
        covered={false}
        depth={0}
        domicile={silentDomicile}
        dragging={false}
        focused={false}
        frame={FRAME}
        fullscreen={false}
        motion="resting"
        onClose={nothingClosed}
        onMotionEnded={nothingEnded}
        onNavigate={() => undefined}
        onOpenWindow={noWindows}
        onReach={() => undefined}
        rect={undefined}
        src="https://example.com"
      />,
    );
    // A hidden element is out of the accessibility tree, so it has no
    // accessible name left to match on — being the only region is enough.
    expect(screen.getByRole("region", { hidden: true })).not.toBeVisible();
  });

  describe("the way it moves", () => {
    /** The props every case here shares; each overrides the one it is about. */
    const windowProps = {
      clickThrough: false,
      covered: false,
      depth: 0,
      domicile: silentDomicile,
      dragging: false,
      focused: false,
      frame: FRAME,
      fullscreen: false,
      motion: "resting",
      onClose: nothingClosed,
      onMotionEnded: nothingEnded,
      onNavigate: () => undefined,
      onOpenWindow: noWindows,
      onReach: () => undefined,
      rect: ON_SCREEN,
      src: "https://example.com",
    } as const;

    it("plays the motion it is given", () => {
      render(<BrowserWindow {...windowProps} motion="opening" />);

      expect(globalThis.getComputedStyle(browser()).animation).toContain(
        "windowOpening",
      );
    });

    // A WINDOW TURNS ABOUT ONE POINT, NOT TWO. Its contents and the bar above
    // them are separate elements, and each scaled about its own center would
    // pull away from the other by a fraction of the window's height.
    it("turns about the middle of its whole frame rather than its own", () => {
      render(<BrowserWindow {...windowProps} motion="opening" />);

      expect(browser()).toHaveStyle({ transformOrigin: "600px 385px" });
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

    // A WINDOW FADES AS IT IS TAKEN HOLD OF AND AS IT IS LET GO. Both ends of
    // a drag change its opacity, and a window that snapped between the two
    // blinked.
    it("fades to see-through as it is taken hold of", () => {
      render(<BrowserWindow {...windowProps} dragging />);

      expect(globalThis.getComputedStyle(browser()).transition).toContain(
        "opacity",
      );
    });

    it("fades back to solid as it is let go", () => {
      render(<BrowserWindow {...windowProps} />);

      expect(globalThis.getComputedStyle(browser()).transition).toContain(
        "opacity",
      );
    });

    // A WINDOW ON ITS WAY OUT ASKS FOR NOTHING AND ANSWERS NOTHING. Its page
    // goes on being drawn — that is the whole point of drawing it rather than
    // something standing in for it — but the keyboard has moved on to whatever
    // is left, and a window still pulling the focus back into its own guest is
    // one the user cannot type past.
    it("leaves the keyboard alone while it is leaving", () => {
      const calls: string[] = [];

      render(
        <BrowserWindow
          {...windowProps}
          domicile={recordingDomicile(calls)}
          focused
          motion="closing"
        />,
      );

      expect(calls).toStrictEqual([]);
    });

    it("takes no pointer while it is leaving, and no keyboard can reach it", () => {
      render(<BrowserWindow {...windowProps} motion="leaving-to-start" />);

      expect(globalThis.getComputedStyle(browser()).pointerEvents).toBe("none");
      expect(browser()).toHaveAttribute("inert");
    });

    it("says when it has played its motion out", async () => {
      await new Promise<void>((resolve) => {
        render(
          <BrowserWindow
            {...windowProps}
            motion="closing"
            onMotionEnded={() => {
              resolve();
            }}
          />,
        );
        fireEvent.animationEnd(browser());
      });
    });
  });
});
