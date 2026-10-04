import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { AppFocusReleaseRequest, AppFocusRequest } from "./app-element";
import {
  APP_FOCUS_RELEASE_REQUESTED_EVENT,
  APP_FOCUS_REQUESTED_EVENT,
  APP_TAG_NAME,
} from "./app-element";
import type { DomicileClient, SurfaceSize } from "./domicile-client";
import { focusApp } from "./focus-app";
import { BTN_LEFT } from "./input";
import type { Measure } from "./measure";
import { registerElements } from "./register-elements";
import { claimShortcut } from "./shortcut-claims";

type Call = readonly [kind: string, ...args: unknown[]];

// A fake domicile client that records input calls and reports each client's
// drawn size. Implements only what input routing uses.
class FakeDomicile {
  readonly calls: Call[] = [];
  readonly #drawn = new Map<string, SurfaceSize>();

  /** Record a client's drawn size, as `app_resized` would. */
  drew(appId: string, size: SurfaceSize): void {
    this.#drawn.set(appId, size);
  }

  surfaceSizeOf(appId: string): SurfaceSize | undefined {
    return this.#drawn.get(appId);
  }
  /** Every client is its own window except `menu`, a popup over `term`. */
  windowOf(appId: string): string {
    return appId === "menu" ? "term" : appId;
  }
  focusApp(appId: string): void {
    this.calls.push(["focusApp", appId]);
  }
  focusChrome(): void {
    this.calls.push(["focusChrome"]);
  }
  pointerMotion(appId: string, x: number, y: number): void {
    this.calls.push(["motion", appId, x, y]);
  }
  pointerButton(appId: string, button: number, pressed: boolean): void {
    this.calls.push(["button", appId, button, pressed]);
  }
  pointerLeave(appId: string): void {
    this.calls.push(["leave", appId]);
  }
  pointerAxis(
    appId: string,
    delta: { dx: number; dy: number; v120X: number; v120Y: number },
  ): void {
    this.calls.push(["axis", appId, delta]);
  }
  key(appId: string, keycode: number, pressed: boolean): void {
    this.calls.push(["key", appId, keycode, pressed]);
  }
}

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  size: [10, 20],
  transform: [1, 0, 0, 1, 0, 0],
});

const mountApp = (appId?: string): HTMLElement => {
  const element = document.createElement(APP_TAG_NAME);
  if (appId !== undefined) {
    element.setAttribute("app-id", appId);
  }
  document.body.append(element);
  return element;
};

/** A bubbling pointer event. */
const pointer = (type: string, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { bubbles: true, ...init });

describe("registerElements", () => {
  let domicile: FakeDomicile;
  // Removes each test's `document` listeners.
  let shell: AbortController;

  beforeEach(() => {
    document.body.innerHTML = "";
    domicile = new FakeDomicile();
    shell = new AbortController();
    registerElements(domicile as unknown as DomicileClient, {
      measure: stubMeasure,
    });
  });

  afterEach(() => {
    shell.abort();
  });

  describe("the pointer over a window", () => {
    it("forwards motion in the client's own surface coordinates", () => {
      // The element measures 10x20; the surface is 100x200.
      const element = mountApp("term");
      domicile.drew("term", [100, 200]);

      element.dispatchEvent(
        pointer("pointermove", { clientX: 5, clientY: 10 }),
      );

      expect(domicile.calls).toContainEqual(["motion", "term", 50, 100]);
    });

    it("maps the element's own pixels 1:1 for a client that has not drawn", () => {
      // A toplevel maps before it draws, so there is no surface size yet.
      const element = mountApp("term");

      element.dispatchEvent(
        pointer("pointermove", { clientX: 5, clientY: 10 }),
      );

      expect(domicile.calls).toContainEqual(["motion", "term", 5, 10]);
    });

    it("forwards a press and the release that matches it", () => {
      const element = mountApp("term");

      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      element.dispatchEvent(pointer("pointerup", { button: 0 }));

      expect(domicile.calls).toContainEqual(["button", "term", BTN_LEFT, true]);
      expect(domicile.calls).toContainEqual([
        "button",
        "term",
        BTN_LEFT,
        false,
      ]);
    });

    it("normalizes a line-mode wheel before forwarding it", () => {
      const element = mountApp("term");

      element.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          deltaMode: 1,
          deltaX: 0,
          deltaY: 3,
        }),
      );

      expect(domicile.calls).toContainEqual([
        "axis",
        "term",
        { dx: 0, dy: 100, v120X: 0, v120Y: 120 },
      ]);
    });

    it("tells the client when the pointer leaves its window", () => {
      // `pointerout`, because `pointerleave` does not bubble. They only differ
      // for descendants, and an `<app>` has none.
      const element = mountApp("term");

      element.dispatchEvent(pointer("pointerout"));

      expect(domicile.calls).toContainEqual(["leave", "term"]);
    });

    it("says nothing for a pointer that is over no window at all", () => {
      // The desktop background belongs to the page, not to any client.
      mountApp("term");

      document.body.dispatchEvent(
        pointer("pointermove", { clientX: 5, clientY: 10 }),
      );

      expect(domicile.calls).toStrictEqual([]);
    });

    it("says nothing for a window that names no client", () => {
      const element = mountApp();

      element.dispatchEvent(
        pointer("pointermove", { clientX: 5, clientY: 10 }),
      );
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));

      expect(domicile.calls).toStrictEqual([]);
    });

    it("swallows the menu the secondary button would have opened over a window", () => {
      // The client gets the right-click, so the browser's context menu would
      // cover the client's own menu.
      const element = mountApp("term");

      const menu = pointer("contextmenu", { cancelable: true });
      element.dispatchEvent(menu);

      expect(menu.defaultPrevented).toBe(true);
    });

    it("leaves the menu alone for a press that is over no window at all", () => {
      // The shell decides what a right-click on the desktop does, so the event
      // must stay cancelable.
      mountApp("term");

      const menu = pointer("contextmenu", { cancelable: true });
      document.body.dispatchEvent(menu);

      expect(menu.defaultPrevented).toBe(false);
    });

    it("announces a click as a focus request the shell can answer for itself", () => {
      const element = mountApp("term");
      const requests: (string | undefined)[] = [];
      document.addEventListener(
        APP_FOCUS_REQUESTED_EVENT,
        (event) => {
          requests.push((event as CustomEvent<AppFocusRequest>).detail.appId);
        },
        { signal: shell.signal },
      );

      element.dispatchEvent(pointer("pointerdown", { button: 0 }));

      expect(requests).toStrictEqual(["term"]);
      expect(domicile.calls).toContainEqual(["focusApp", "term"]);
    });

    it("asks for a popup's window when the popup is clicked", () => {
      // The shell knows windows, not popups, so the request names the popup's
      // window.
      const element = mountApp("menu");
      const requests: (string | undefined)[] = [];
      document.addEventListener(
        APP_FOCUS_REQUESTED_EVENT,
        (event) => {
          requests.push((event as CustomEvent<AppFocusRequest>).detail.appId);
        },
        { signal: shell.signal },
      );

      element.dispatchEvent(pointer("pointerdown", { button: 0 }));

      expect(requests).toStrictEqual(["term"]);
      expect(domicile.calls).toContainEqual(["focusApp", "term"]);
      // The button press still goes to the popup.
      expect(domicile.calls).toContainEqual(["button", "menu", BTN_LEFT, true]);
    });

    it("leaves the keyboard alone when the shell cancels the request", () => {
      const element = mountApp("term");
      document.addEventListener(
        APP_FOCUS_REQUESTED_EVENT,
        (event) => {
          event.preventDefault();
        },
        { signal: shell.signal },
      );

      element.dispatchEvent(pointer("pointerdown", { button: 0 }));

      expect(domicile.calls).not.toContainEqual(["focusApp", "term"]);
      // The shell refused focus, not the click.
      expect(domicile.calls).toContainEqual(["button", "term", BTN_LEFT, true]);
    });
  });

  describe("the keyboard", () => {
    it("clicking a window sends it every keystroke that follows", () => {
      const element = mountApp("term");

      element.dispatchEvent(pointer("pointerdown", { button: 0 }));

      // KeyA is evdev 30.
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );
      expect(domicile.calls).toContainEqual(["key", "term", 30, true]);
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );
      expect(domicile.calls).toContainEqual(["key", "term", 30, false]);
    });

    it("gives a client the keyboard without a click", () => {
      // For example, when a shell opens a window or switches to its tab.
      mountApp("term");

      focusApp(domicile as unknown as DomicileClient, "term");
      expect(domicile.calls).toContainEqual(["focusApp", "term"]);

      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );
      expect(domicile.calls).toContainEqual(["key", "term", 30, true]);
      // Release the key so it does not stay down for later tests.
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );
    });

    it("keeps a chord the desktop claimed out of the focused window", () => {
      // The shell's `keydown` handler sees keys sent to Wayland windows too.
      // Without the claim, Alt+Enter would also type a newline into the
      // focused terminal.
      claimShortcut({ altKey: true, keycode: 28 });
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          code: "Enter",
        }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keyup", {
          altKey: true,
          bubbles: true,
          code: "Enter",
        }),
      );

      expect(domicile.calls.filter(([kind]) => kind === "key")).toEqual([]);
    });

    it("ignores the browser's auto-repeat while a key is held", () => {
      // Wayland clients generate their own repeats from
      // `wl_keyboard.repeat_info`. Forwarding the browser's would double them.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );
      for (let held = 0; held < 5; held++) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            code: "KeyA",
            repeat: true,
          }),
        );
      }
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );

      expect(domicile.calls.filter(([kind]) => kind === "key")).toEqual([
        ["key", "term", 30, true],
        ["key", "term", 30, false],
      ]);
    });

    it("releases a key wherever the keyboard went between press and release", () => {
      // A lost release leaves the key down in the compositor's xkb state. Under
      // `caps:swapescape`, Escape (evdev 1) is Caps_Lock, so a lost release
      // locks capitals in every Wayland client.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
      domicile.calls.length = 0;

      // Focus moves to the chrome while the key is down.
      document.body.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "Escape" }),
      );

      expect(domicile.calls).toContainEqual(["key", "term", 1, false]);
    });

    it("releases what it is holding when the page loses the keyboard", () => {
      // The page never sees the keyup, so the key would stay down in the
      // compositor.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
      domicile.calls.length = 0;

      globalThis.window.dispatchEvent(new Event("blur"));

      expect(domicile.calls).toEqual([["key", "term", 1, false]]);
    });

    it("releases what it is holding when a browser window takes the focus", () => {
      // A keyup inside a `<webview>` never reaches this document, so a held
      // Super would stay down in the seat.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "MetaLeft" }),
      );
      domicile.calls.length = 0;

      const view = document.createElement("webview");
      document.body.append(view);
      view.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      expect(domicile.calls).toEqual([["key", "term", 125, false]]);
    });

    it("releases what it is holding when the page goes away", () => {
      // Navigation fires `pagehide`, not `blur`, and no keyup follows.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
      domicile.calls.length = 0;

      globalThis.window.dispatchEvent(new Event("pagehide"));

      expect(domicile.calls).toEqual([["key", "term", 1, false]]);
    });

    it("releases onto the domicile that is connected now", () => {
      // The compositor's seat holds the key down, so release it on the
      // current connection.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
      const rebound = new FakeDomicile();
      registerElements(rebound as unknown as DomicileClient, {
        measure: stubMeasure,
      });
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "Escape" }),
      );

      expect(rebound.calls).toEqual([["key", "term", 1, false]]);
      expect(domicile.calls).toEqual([]);
    });

    it("stops routing keys to a window that has left the page", () => {
      // `<app>` has no disconnect callback. Without this check, every key
      // would be `preventDefault`ed and sent to the closed client. Focus
      // returns to the chrome instead.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      element.remove();
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );

      expect(domicile.calls).toStrictEqual([["focusChrome"]]);
    });

    it("leaves the keyboard alone when an unfocused window goes away", () => {
      // Closing a background window must not take focus from the focused
      // one.
      const focusedWindow = mountApp("term");
      focusedWindow.dispatchEvent(pointer("pointerdown", { button: 0 }));
      const other = mountApp("editor");
      other.remove();
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );

      expect(domicile.calls).toStrictEqual([["key", "term", 30, true]]);
      // Release the key so it does not stay down for later tests.
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );
    });

    it("releases a key this page never saw pressed", () => {
      // For example, Super held across a reload. The seat ignores releases for
      // keys it does not hold, so sending every release is safe.
      mountApp("term").dispatchEvent(pointer("pointerdown", { button: 0 }));
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "MetaLeft" }),
      );

      expect(domicile.calls).toEqual([["key", "term", 125, false]]);
    });

    it("keeps the keyboard where it is when the shell cancels the release", () => {
      // A press on shell-drawn window decorations lands outside every `<app>`.
      // Only the shell can tell that from the desktop background.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      const chrome = document.createElement("div");
      document.body.append(chrome);
      document.addEventListener(
        APP_FOCUS_RELEASE_REQUESTED_EVENT,
        (event) => {
          event.preventDefault();
        },
        { signal: shell.signal },
      );
      domicile.calls.length = 0;

      chrome.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );

      expect(domicile.calls).toStrictEqual([["key", "term", 30, true]]);
      // Release the key so it does not stay down for later tests.
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );
    });

    it("names the window whose keyboard is being asked for", () => {
      // `pressed` is the clicked element; `appId` is the window about to lose
      // focus.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      const chrome = document.createElement("div");
      document.body.append(chrome);
      const asked: AppFocusReleaseRequest[] = [];
      document.addEventListener(
        APP_FOCUS_RELEASE_REQUESTED_EVENT,
        (event) => {
          asked.push((event as CustomEvent<AppFocusReleaseRequest>).detail);
        },
        { signal: shell.signal },
      );

      chrome.dispatchEvent(pointer("pointerdown", { button: 0 }));

      expect(asked).toStrictEqual([{ appId: "term", pressed: chrome }]);
    });

    it("clicking off every window returns the keyboard to the chrome", () => {
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      domicile.calls.length = 0;

      document.body.dispatchEvent(pointer("pointerdown", { button: 0 }));

      expect(domicile.calls).toContainEqual(["focusChrome"]);
    });
  });
});
