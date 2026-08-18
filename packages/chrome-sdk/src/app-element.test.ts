import { beforeEach, describe, expect, it } from "bun:test";

import type { DomicileAppElement } from "./app-element";
import type { BridgeClient } from "./bridge";
import { BTN_LEFT } from "./input";
import type { Measure } from "./measure";
import type { ObserveResize } from "./observe-resize";
import { APP_TAG_NAME, registerElements } from "./register-elements";

type Call = readonly [kind: string, ...args: unknown[]];

// A double for the bridge, capturing the portal lifecycle and input calls the
// elements make. Only the surface the elements use is implemented.
class FakeBridge {
  readonly calls: Call[] = [];

  placePortal(placement: { appId: string; size: readonly number[] }): void {
    this.calls.push(["place", placement]);
  }
  removePortal(appId: string): void {
    this.calls.push(["remove", appId]);
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
  zIndex: 0,
});

// The test DOM lays nothing out, so its ResizeObserver never fires; the
// observer is injected instead and driven by hand.
class FakeResizeObserver {
  #callbacks: (() => void)[] = [];

  readonly observe: ObserveResize = (_element, onResize) => {
    this.#callbacks.push(onResize);
    return () => {
      this.#callbacks = this.#callbacks.filter((entry) => entry !== onResize);
    };
  };

  /** Simulate the browser reporting a new box for every watched element. */
  resize(): void {
    for (const callback of this.#callbacks) {
      callback();
    }
  }

  get watching(): number {
    return this.#callbacks.length;
  }
}

const mountApp = (appId?: string): DomicileAppElement => {
  const element = document.createElement(APP_TAG_NAME) as DomicileAppElement;
  if (appId !== undefined) {
    element.setAttribute("app-id", appId);
  }
  document.body.append(element);
  return element;
};

describe("<domicile-app>", () => {
  let bridge: FakeBridge;
  let resizes: FakeResizeObserver;

  beforeEach(() => {
    document.body.innerHTML = "";
    bridge = new FakeBridge();
    resizes = new FakeResizeObserver();
    registerElements(bridge as unknown as BridgeClient, {
      measure: stubMeasure,
      observeResize: resizes.observe,
    });
  });

  it("places a portal when connected with an app-id", () => {
    mountApp("term");
    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "term",
        size: [10, 20],
        transform: [1, 0, 0, 1, 0, 0],
        visible: true,
        zIndex: 0,
      },
    ]);
  });

  it("asks the compositor to render the client at the element's size", () => {
    mountApp("term");
    expect(bridge.calls).toContainEqual(["resize", "term", [10, 20]]);
  });

  it("leaves a client's size alone while its element has no box", () => {
    // A tabbed chrome hides every inactive window, and a hidden element
    // measures as nothing: reporting that as a resize would configure the
    // client to 0x0 and make it redraw on every tab switch.
    registerElements(bridge as unknown as BridgeClient, {
      measure: () => ({
        size: [0, 0],
        transform: [1, 0, 0, 1, 0, 0],
        visible: false,
        zIndex: 0,
      }),
      observeResize: resizes.observe,
    });
    mountApp("term");

    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "term",
        size: [0, 0],
        transform: [1, 0, 0, 1, 0, 0],
        visible: false,
        zIndex: 0,
      },
    ]);
    expect(bridge.calls.some(([kind]) => kind === "resize")).toBe(false);
  });

  it("re-reports geometry when the element's box changes", () => {
    mountApp("term");
    bridge.calls.length = 0;

    resizes.resize();
    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "term",
        size: [10, 20],
        transform: [1, 0, 0, 1, 0, 0],
        visible: true,
        zIndex: 0,
      },
    ]);
    expect(bridge.calls).toContainEqual(["resize", "term", [10, 20]]);
  });

  it("stops watching the box once disconnected", () => {
    mountApp("term").remove();
    expect(resizes.watching).toBe(0);
  });

  it("applies a client's requested cursor to the element", () => {
    const element = mountApp("term");
    element.applyCursor("text");
    expect(element.style.cursor).toBe("text");
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
    expect(bridge.calls).toContainEqual([
      "axis",
      "term",
      { dx: 0, dy: 100, v120X: 0, v120Y: 120 },
    ]);
  });

  it("removes the portal when disconnected", () => {
    mountApp("term").remove();
    expect(bridge.calls).toContainEqual(["remove", "term"]);
  });

  it("takes the keyboard back when the focused window goes away", () => {
    // Otherwise the host is left holding a focus for a client that no longer
    // exists, and the chrome stops receiving keys — a desktop that works right
    // up until you close a window.
    const element = mountApp("term");
    element.focusApp();

    element.remove();

    expect(bridge.calls).toContainEqual(["focusChrome"]);
  });

  it("leaves the keyboard alone when an unfocused window goes away", () => {
    // Closing a background window must not steal the keyboard from the one
    // that has it.
    const focused = mountApp("term");
    focused.focusApp();
    const other = mountApp("other");

    other.remove();

    expect(bridge.calls).not.toContainEqual(["focusChrome"]);
  });

  it("does nothing without an app-id", () => {
    mountApp();
    expect(bridge.calls).toHaveLength(0);
  });

  it("re-places when the app-id changes", () => {
    const element = mountApp("term");
    bridge.calls.length = 0;

    element.setAttribute("app-id", "editor");
    expect(bridge.calls).toContainEqual(["remove", "term"]);
    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "editor",
        size: [10, 20],
        transform: [1, 0, 0, 1, 0, 0],
        visible: true,
        zIndex: 0,
      },
    ]);
  });

  it("exposes appId as a property", () => {
    const element = document.createElement(APP_TAG_NAME) as DomicileAppElement;
    element.setAttribute("app-id", "term");
    expect(element.appId).toBe("term");
  });

  it("drawFrame creates a canvas surface", () => {
    const element = mountApp("term");
    // The test DOM has no 2d context, so this exercises the canvas-creation
    // path and must not throw even when drawing is unavailable.
    element.drawFrame(2, 1, 1, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(element.querySelector("canvas")).not.toBeNull();
  });

  it("drops the placeholder as soon as the client has a size", () => {
    // Where the compositor draws the client's surface itself no pixels ever
    // reach the element, so a placeholder that waited for them would stay up —
    // and be drawn by the page *over* the window it is standing in for.
    const element = mountApp("term");
    expect(element.classList.contains("has-surface")).toBe(false);

    element.setSurfaceSize(800, 600);

    expect(element.classList.contains("has-surface")).toBe(true);
  });

  it("sizes the canvas backing store in device pixels", () => {
    // The whole point of scaling: the element stays the same size in CSS while
    // the canvas holds every pixel the client drew. A backing store sized in
    // logical units would be stretched over the display's real pixels, which
    // is exactly the blurriness this exists to remove.
    const element = mountApp("term");

    element.drawFrame(64, 32, 2, new Uint8Array(64 * 32 * 4));

    const canvas = element.querySelector("canvas");
    expect([canvas?.width, canvas?.height]).toEqual([64, 32]);
  });

  it("maps the pointer through the logical size, not the pixel one", () => {
    // `wl_pointer` speaks surface-local *logical* coordinates. Dividing the
    // element's box by the buffer's pixel dimensions instead would put the
    // pointer at half the position it should be on a 2x display.
    const element = mountApp("term");
    // stubMeasure lays the element out at 10x20, and the client answers at 2x.
    element.drawFrame(20, 40, 2, new Uint8Array(20 * 40 * 4));

    element.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 5, clientY: 10 }),
    );

    expect(bridge.calls).toContainEqual(["motion", "term", 5, 10]);
  });

  it("clicking an app focuses it and forwards subsequent keystrokes", () => {
    const element = mountApp("term");

    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    expect(bridge.calls).toContainEqual(["focusApp", "term"]);
    expect(bridge.calls).toContainEqual(["button", "term", BTN_LEFT, true]);

    // A global keystroke now reaches the focused app (KeyA -> evdev 30).
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
    );
    expect(bridge.calls).toContainEqual(["key", "term", 30, true]);
    document.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, code: "KeyA" }),
    );
    expect(bridge.calls).toContainEqual(["key", "term", 30, false]);
  });

  it("focusApp gives the client the keyboard without a click", () => {
    const element = mountApp("term");

    element.focusApp();
    expect(bridge.calls).toContainEqual(["focusApp", "term"]);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "KeyA" }),
    );
    expect(bridge.calls).toContainEqual(["key", "term", 30, true]);
  });

  it("ignores the browser's auto-repeat while a key is held", () => {
    // Wayland sends one press and one release; the client synthesises repeat
    // itself from `wl_keyboard.repeat_info`. Forwarding the browser's repeats
    // as fresh presses gives the client two repeat sources at once, which it
    // renders as the same character over and over.
    const element = mountApp("term");
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    bridge.calls.length = 0;

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

    expect(bridge.calls.filter(([kind]) => kind === "key")).toEqual([
      ["key", "term", 30, true],
      ["key", "term", 30, false],
    ]);
  });

  it("clicking off every app returns keyboard focus to the chrome", () => {
    const element = mountApp("term");
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    bridge.calls.length = 0;

    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    expect(bridge.calls).toContainEqual(["focusChrome"]);
  });
});
