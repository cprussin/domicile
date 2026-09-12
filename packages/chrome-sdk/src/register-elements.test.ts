import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { AppFocusRequest } from "./app-element";
import { APP_FOCUS_REQUESTED_EVENT, APP_TAG_NAME } from "./app-element";
import type { DomicileClient, SurfaceSize } from "./domicile-client";
import { focusApp } from "./focus-app";
import { BTN_LEFT } from "./input";
import type { Matrix, Point } from "./matrix";
import type { Measure } from "./measure";
import type { ObservePlacement } from "./observe-placement";
import { placementTiming } from "./placement-timing";
import { registerElements } from "./register-elements";

type Call = readonly [kind: string, ...args: unknown[]];

// A double for the domicile client, capturing the size reports and input calls
// the delegation makes, and answering for what each client has drawn. Only the
// surface the delegation uses is implemented.
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
  resizeApp(appId: string, size: readonly number[]): void {
    this.calls.push(["resize", appId, size]);
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
  visible: true,
});

// happy-dom does animate frames — and as fast as it can, which is not a clock
// anything can assert against. The observer is injected so a test says when a
// frame happened.
class FakeFrames {
  #callbacks: (() => void)[] = [];

  readonly observe: ObservePlacement = (onFrame) => {
    this.#callbacks.push(onFrame);
    return () => {
      this.#callbacks = this.#callbacks.filter((entry) => entry !== onFrame);
    };
  };

  /** Simulate the page reaching its next animation frame. */
  turn(): void {
    for (const callback of this.#callbacks) {
      callback();
    }
  }
}

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
  let frames: FakeFrames;
  // A shell listens for focus requests on `document` rather than per window, so
  // those listeners outlive the element that was clicked and the body this
  // empties between tests. Aborting is what takes them off again.
  let shell: AbortController;

  beforeEach(() => {
    document.body.innerHTML = "";
    domicile = new FakeDomicile();
    frames = new FakeFrames();
    shell = new AbortController();
    registerElements(domicile as unknown as DomicileClient, {
      measure: stubMeasure,
      observePlacement: frames.observe,
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

    it("normalises a line-mode wheel before forwarding it", () => {
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

    it("ignores the browser's auto-repeat while a key is held", () => {
      // Wayland sends one press and one release; the client synthesises repeat
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
        observePlacement: frames.observe,
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

    it("clicking off every window returns the keyboard to the chrome", () => {
      const element = mountApp("term");
      element.dispatchEvent(pointer("pointerdown", { button: 0 }));
      domicile.calls.length = 0;

      document.body.dispatchEvent(pointer("pointerdown", { button: 0 }));

      expect(domicile.calls).toContainEqual(["focusChrome"]);
    });
  });

  describe("the size the page laid a window out at", () => {
    it("asks the compositor to render the client at the element's size", () => {
      mountApp("term");

      frames.turn();

      expect(domicile.calls).toContainEqual(["resize", "term", [10, 20]]);
    });

    it("leaves a client's size alone while its element has no box", () => {
      // A tabbed chrome hides every inactive window, and a hidden element
      // measures as nothing: reporting that as a resize would configure the
      // client to 0x0 and make it redraw on every tab switch.
      registerElements(domicile as unknown as DomicileClient, {
        measure: () => ({
          size: [0, 0],
          transform: [1, 0, 0, 1, 0, 0],
          visible: false,
        }),
        observePlacement: frames.observe,
      });
      mountApp("term");

      frames.turn();

      expect(domicile.calls.some(([kind]) => kind === "resize")).toBe(false);
    });

    it("says nothing about a window that did not change size", () => {
      // Measuring happens on every animation frame, so a window that is simply
      // sitting there would otherwise configure its client sixty times a second
      // — down a socket shared with every client's pixels, and a client redraws
      // every time it is configured.
      mountApp("term");
      frames.turn();
      domicile.calls.length = 0;

      frames.turn();
      frames.turn();

      expect(domicile.calls).toStrictEqual([]);
    });

    it("does not make a client redraw because its window moved", () => {
      // A client repaints when it is configured, so sending its size again for
      // a window that only moved would cost every app on the desktop a repaint
      // per frame of any animation.
      const moved = { transform: [1, 0, 0, 1, 0, 0] as Matrix };
      registerElements(domicile as unknown as DomicileClient, {
        measure: (element) => ({ ...stubMeasure(element), ...moved }),
        observePlacement: frames.observe,
      });
      mountApp("term");
      frames.turn();
      domicile.calls.length = 0;

      moved.transform = [1, 0, 0, 1, 40, 5];
      frames.turn();

      expect(domicile.calls.some(([kind]) => kind === "resize")).toBe(false);
    });

    it("configures the client again when the element's box changes", () => {
      const box = { size: [10, 20] as Point };
      registerElements(domicile as unknown as DomicileClient, {
        measure: (element) => ({ ...stubMeasure(element), ...box }),
        observePlacement: frames.observe,
      });
      mountApp("term");
      frames.turn();
      domicile.calls.length = 0;

      box.size = [30, 40];
      frames.turn();

      expect(domicile.calls).toContainEqual(["resize", "term", [30, 40]]);
    });

    it("tells a newly shown app what size to render at", () => {
      // What identifies this instruction is what it would say, and the app it
      // is about is half of that. Keyed on the size alone, an element that
      // swapped `app-id` while keeping its box would never configure the new
      // client — it would draw at whatever the previous one happened to be
      // until the element next resized, which for a window that fills the stage
      // is never.
      const element = mountApp("term");
      frames.turn();
      domicile.calls.length = 0;

      element.setAttribute("app-id", "editor");
      frames.turn();

      expect(domicile.calls).toContainEqual(["resize", "editor", [10, 20]]);
    });

    it("configures a client again when the host never received the last size", () => {
      // Recording the key before the send would leave the SDK sure it had
      // reported a size that never arrived — and because the record is what
      // suppresses the next one, nothing would send it again until the window
      // changed size.
      const box = { size: [10, 20] as Point };
      registerElements(domicile as unknown as DomicileClient, {
        measure: (element) => ({ ...stubMeasure(element), ...box }),
        observePlacement: frames.observe,
      });
      mountApp("term");
      frames.turn();
      const resizeApp = domicile.resizeApp.bind(domicile);
      domicile.resizeApp = () => {
        throw new Error("the socket went away");
      };

      box.size = [30, 40];
      expect(() => {
        frames.turn();
      }).toThrow("the socket went away");
      domicile.resizeApp = resizeApp;
      domicile.calls.length = 0;
      frames.turn();

      expect(domicile.calls).toContainEqual(["resize", "term", [30, 40]]);
    });

    it("stops measuring a window that has left the page", () => {
      // A detached element is laid out at nothing, so measuring one reports a
      // size the page never gave it — and the shell that took it down is not
      // asking for the client to be reconfigured.
      const element = mountApp("term");
      frames.turn();
      element.remove();
      placementTiming.take();

      frames.turn();

      expect(placementTiming.take()).toBeUndefined();
    });

    it("prices every measurement, not only the ones that send something", () => {
      // What costs is the measuring, and the measuring happens for every window
      // on every frame whether or not anything changed. A timing that only
      // counted the frames that resized a window would report an idle desktop
      // as free, which is exactly the claim in doubt.
      mountApp("term");
      placementTiming.take();

      frames.turn();
      frames.turn();

      expect(placementTiming.take()?.count).toBe(2);
    });

    it("prices a measurement that threw, which has already cost the same", () => {
      // `readElementTransform` throws on a computed value it cannot parse, from
      // after the layout read. Priced only on success, such a window would cost
      // the desktop a measurement and contribute nothing to the number — so the
      // desktop where this matters most is the one it would under-report
      // hardest.
      registerElements(domicile as unknown as DomicileClient, {
        measure: () => {
          throw new Error("a window the SDK could not measure");
        },
        observePlacement: frames.observe,
      });
      mountApp("term");
      placementTiming.take();

      expect(() => {
        frames.turn();
      }).toThrow("a window the SDK could not measure");

      expect(placementTiming.take()?.count).toBe(1);
    });

    it("keeps measuring the windows after one that could not be measured", () => {
      // One loop for every window means one window could take the others down
      // with it, and a throw is not hypothetical: `new DOMMatrix(…)` throws on a
      // computed value the SDK cannot parse, and it has. A desktop where the
      // second window stops being configured because the first has bad CSS is
      // not a trade anyone made.
      const failing = mountApp("broken");
      mountApp("term");
      registerElements(domicile as unknown as DomicileClient, {
        measure: (element) => {
          if (element === failing) {
            throw new Error("a window the SDK could not measure");
          } else {
            return stubMeasure(element);
          }
        },
        observePlacement: frames.observe,
      });

      expect(() => {
        frames.turn();
      }).toThrow("a window the SDK could not measure");

      expect(domicile.calls).toContainEqual(["resize", "term", [10, 20]]);
    });
  });
});
