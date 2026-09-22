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

// A double for the domicile client, capturing the input calls the delegation
// makes and answering for what each client has drawn. Only the surface the
// delegation uses is implemented.
class FakeDomicile {
  readonly calls: Call[] = [];
  readonly #drawn = new Map<string, SurfaceSize>();

  /** As `app_resized` would: the client says what it drew by drawing. */
  drew(appId: string, size: SurfaceSize): void {
    this.#drawn.set(appId, size);
  }

  surfaceSizeOf(appId: string): SurfaceSize | undefined {
    return this.#drawn.get(appId);
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

/** A pointer event, as the delegation on `document` receives it. */
const pointer = (type: string, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(type, { bubbles: true, ...init });

describe("registerElements", () => {
  let domicile: FakeDomicile;
  // A shell listens for focus requests on `document` rather than per window, so
  // those listeners outlive the element that was clicked and the body this
  // empties between tests. Aborting is what takes them off again.
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
      // The element measures 10x20 here, so a client that drew at 100x200 puts
      // the pointer ten times further into its surface than into the box.
      const element = mountApp("term");
      domicile.drew("term", [100, 200]);

      element.dispatchEvent(
        pointer("pointermove", { clientX: 5, clientY: 10 }),
      );

      expect(domicile.calls).toContainEqual(["motion", "term", 50, 100]);
    });

    it("maps the element's own pixels 1:1 for a client that has not drawn", () => {
      // A toplevel maps before it draws, and the pointer is over it in the
      // meantime. Its own box is the only scale there is.
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
      // `pointerout` rather than `pointerleave`, which does not bubble and so
      // cannot be delegated at all. The two differ only for a pointer moving
      // into a descendant, and an `<app>` is a replaced element: it has no
      // rendered children to move into.
      const element = mountApp("term");

      element.dispatchEvent(pointer("pointerout"));

      expect(domicile.calls).toContainEqual(["leave", "term"]);
    });

    it("says nothing for a pointer that is over no window at all", () => {
      // The desktop behind the windows is the page's own, and a click on it is
      // nobody's client's.
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
      // The click itself still belongs to the client: what the shell refused is
      // the keyboard, not the button the user pressed.
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
      // What a shell calls when it puts a window on screen that nobody clicked
      // — opening it, or switching to its tab.
      mountApp("term");

      focusApp(domicile as unknown as DomicileClient, "term");
      expect(domicile.calls).toContainEqual(["focusApp", "term"]);

      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );
      expect(domicile.calls).toContainEqual(["key", "term", 30, true]);
      // Released, because a key left down is left down for the whole suite.
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );
    });

    it("keeps a chord the desktop claimed out of the focused window", () => {
      // A Wayland window is an element in this page, so DOM focus never leaves
      // the document and the shell's own `keydown` handler sees the press as
      // well as the forwarding here. Without the claim both act: Alt+Enter
      // spawns a terminal *and* types a newline into the one already open.
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
      // Wayland sends one press and one release; the client synthesizes repeat
      // itself from `wl_keyboard.repeat_info`. Forwarding the browser's repeats
      // as fresh presses gives the client two repeat sources at once, which it
      // renders as the same character over and over.
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
      // The compositor's xkb state outlives every window, and it only unlocks a
      // lock key on the release of the press it saw lock it. Under
      // `caps:swapescape` the physical Escape key *is* Caps_Lock (evdev 1), so a
      // press forwarded without its release latches capitals into every Wayland
      // client there will ever be — no later press of that key can clear it,
      // while the page's own webviews, which never touch that state, keep
      // typing normally.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
      domicile.calls.length = 0;

      // The keyboard goes back to the chrome while the key is still down.
      document.body.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "Escape" }),
      );

      expect(domicile.calls).toContainEqual(["key", "term", 1, false]);
    });

    it("releases what it is holding when the page loses the keyboard", () => {
      // A window the user alt-tabs away from is never told the key came up, so
      // the release has to be sent on the way out. Otherwise the key is held
      // down in the compositor for as long as the desktop runs.
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
      domicile.calls.length = 0;

      globalThis.window.dispatchEvent(new Event("blur"));

      expect(domicile.calls).toEqual([["key", "term", 1, false]]);
    });

    it("releases what it is holding when the page goes away", () => {
      // A reload never delivers the keyup, and blur is not what fires when the
      // page is navigated away from.
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
      // The release is for the compositor's sake — its seat is what holds the
      // key down — so it belongs on the connection to that compositor, not on
      // whichever client object happened to be bound when the key went down.
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
      // A shell takes an element down when its client closes, and with the tag
      // the engine's there is no callback to hear that on. Left alone, every
      // keystroke after a window closes is taken from the page — the forward
      // calls `preventDefault()` — and sent to a client that is gone, which is a
      // desktop that works right up until you close a window. The chrome is told
      // it has the keyboard back as well, because the page is where it went.
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
      // Closing a background window must not steal the keyboard from the one
      // that has it. The repair above is keyed on the window the keyboard was
      // routed to and not on whichever window left.
      const focusedWindow = mountApp("term");
      focusedWindow.dispatchEvent(pointer("pointerdown", { button: 0 }));
      const other = mountApp("editor");
      other.remove();
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
      );

      expect(domicile.calls).toStrictEqual([["key", "term", 30, true]]);
      // Released, because a key left down is left down for the whole suite.
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );
    });

    it("does not release a key it never forwarded a press for", () => {
      // Pressed while the chrome had the keyboard: the client never saw the key
      // go down, and a release for it is a key event that never happened.
      const element = mountApp("term");
      // The chrome has the keyboard, said rather than assumed: which window has
      // it is one cell that outlives any single window.
      document.body.dispatchEvent(pointer("pointerdown", { button: 0 }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      domicile.calls.length = 0;

      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "Escape" }),
      );

      expect(domicile.calls).toEqual([]);
    });

    it("keeps the keyboard where it is when the shell cancels the release", () => {
      // The other half of the focus contract, and the half a shell that draws
      // its own window chrome needs: a press on a float's title bar or on the
      // sheet an Alt+drag is caught on lands off every `<app>`, and the SDK
      // cannot tell that chrome from the wallpaper behind it. The shell can, so
      // it is asked.
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
      // Released, because a key left down is left down for the whole suite.
      document.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
      );
    });

    it("names the window whose keyboard is being asked for", () => {
      // The press is what a shell decides on — a float's own chrome is a reach
      // for that window, and the desktop behind it is a reach away — and the
      // app id is which window is about to lose the keyboard.
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
