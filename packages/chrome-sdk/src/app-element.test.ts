import { beforeEach, describe, expect, it } from "bun:test";

import type { DomicileAppElement } from "./app-element";
import type { BridgeClient } from "./bridge";
import { BTN_LEFT } from "./input";
import type { Matrix, Point } from "./matrix";
import type { Measure } from "./measure";
import type { ObservePlacement } from "./observe-placement";
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
  cornerRadius: 0,
  native: true,
  opacity: 1,
  shadow: undefined,
  size: [10, 20],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
  zIndex: 0,
});

// happy-dom does animate frames — and as fast as it can, which is not a clock
// anything can assert against. The observer is injected so a test says when a
// frame happened.
class FakeFrames {
  #callbacks: (() => void)[] = [];

  readonly observe: ObservePlacement = (onMoved) => {
    this.#callbacks.push(onMoved);
    return () => {
      this.#callbacks = this.#callbacks.filter((entry) => entry !== onMoved);
    };
  };

  /** Simulate the page reaching its next animation frame. */
  turn(): void {
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
  let frames: FakeFrames;

  beforeEach(() => {
    document.body.innerHTML = "";
    bridge = new FakeBridge();
    frames = new FakeFrames();
    registerElements(bridge as unknown as BridgeClient, {
      measure: stubMeasure,
      observePlacement: frames.observe,
    });
  });

  it("places a portal when connected with an app-id", () => {
    mountApp("term");
    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "term",
        cornerRadius: 0,
        native: true,
        opacity: 1,
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
        cornerRadius: 0,
        native: true,
        opacity: 1,
        shadow: undefined,
        size: [0, 0],
        transform: [1, 0, 0, 1, 0, 0],
        visible: false,
        zIndex: 0,
      }),
      observePlacement: frames.observe,
    });
    mountApp("term");

    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "term",
        cornerRadius: 0,
        native: true,
        opacity: 1,
        shadow: undefined,
        size: [0, 0],
        transform: [1, 0, 0, 1, 0, 0],
        visible: false,
        zIndex: 0,
      },
    ]);
    expect(bridge.calls.some(([kind]) => kind === "resize")).toBe(false);
  });

  it("re-reports geometry when the element moves", () => {
    // Moving is the case a `ResizeObserver` cannot see and the one a chrome
    // does most: the box is the same size somewhere else. A portal that
    // followed only size would sit still while its element slid across the
    // page, and the window would come apart from the hole it is drawn into.
    const moved = { transform: [1, 0, 0, 1, 0, 0] as Matrix };
    registerElements(bridge as unknown as BridgeClient, {
      measure: (element) => ({ ...stubMeasure(element), ...moved }),
      observePlacement: frames.observe,
    });
    mountApp("term");
    bridge.calls.length = 0;

    moved.transform = [1, 0, 0, 1, 40, 5];
    frames.turn();

    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "term",
        cornerRadius: 0,
        native: true,
        opacity: 1,
        size: [10, 20],
        transform: [1, 0, 0, 1, 40, 5],
        visible: true,
        zIndex: 0,
      },
    ]);
  });

  it("says nothing about a window that did not move", () => {
    // Measuring happens on every animation frame now, so a window that is
    // simply sitting there would otherwise send its placement sixty times a
    // second down a socket shared with every client's pixels.
    mountApp("term");
    bridge.calls.length = 0;

    frames.turn();
    frames.turn();

    expect(bridge.calls).toStrictEqual([]);
  });

  it("does not make a client redraw because its window moved", () => {
    // A client repaints when it is configured, so sending its size again for
    // a window that only moved would cost every app on the desktop a repaint
    // per frame of any animation.
    const moved = { transform: [1, 0, 0, 1, 0, 0] as Matrix };
    registerElements(bridge as unknown as BridgeClient, {
      measure: (element) => ({ ...stubMeasure(element), ...moved }),
      observePlacement: frames.observe,
    });
    mountApp("term");
    bridge.calls.length = 0;

    moved.transform = [1, 0, 0, 1, 40, 5];
    frames.turn();

    expect(bridge.calls.some(([kind]) => kind === "resize")).toBe(false);
  });

  it("re-reports geometry when the element's box changes", () => {
    const box = { size: [10, 20] as Point };
    registerElements(bridge as unknown as BridgeClient, {
      measure: (element) => ({ ...stubMeasure(element), ...box }),
      observePlacement: frames.observe,
    });
    mountApp("term");
    bridge.calls.length = 0;

    box.size = [30, 40];
    frames.turn();

    expect(bridge.calls).toContainEqual(["resize", "term", [30, 40]]);
  });

  it("reports a window afresh after telling the host to forget it", () => {
    // The host no longer knows where this window is, so the placement that
    // follows a remount has to be sent however little the element moved. A
    // record kept across the gap would leave the portal unplaced for as long
    // as nothing about the element changed.
    const element = mountApp("term");
    const parent = document.createElement("div");
    document.body.append(parent);
    bridge.calls.length = 0;

    parent.append(element);

    expect(bridge.calls.some(([kind]) => kind === "place")).toBe(true);
  });

  it("stops watching the box once disconnected", () => {
    mountApp("term").remove();
    expect(frames.watching).toBe(0);
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
        cornerRadius: 0,
        native: true,
        opacity: 1,
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

  it("clips the copied pixels to the element's own rounding", () => {
    // Content is not clipped by the box that holds it: `border-radius` rounds
    // this element and does nothing to a child. A window sent down the copy
    // path *because* of its radius would be drawn square by the very path that
    // was meant to draw it round. On the canvas rather than as `overflow` on
    // the element, whose inline style belongs to whoever wrote the chrome.
    const element = mountApp("term");

    element.drawFrame(2, 1, 1, new Uint8Array(8));

    expect(element.querySelector("canvas")?.style.borderRadius).toBe("inherit");
    expect(element.style.overflow).toBe("");
  });

  it("drops the copied pixels when the host says it has taken the window", () => {
    // The chrome is composited *over* the client, so a canvas still holding
    // the last copied frame is opaque where the page has to be a hole: the
    // live window would be hidden behind a still of itself.
    const element = mountApp("term");
    element.drawFrame(2, 1, 1, new Uint8Array(8));
    expect(element.querySelector("canvas")).not.toBeNull();

    element.dropSurface();

    expect(element.querySelector("canvas")).toBeNull();
  });

  it("keeps the copied pixels until the host says so, however it is styled", () => {
    // The element knows what it *asked* for, which is not the same as what the
    // compositor managed: a `wl_shm` client is never drawn natively however
    // ordinary its CSS. A chrome that dropped the canvas on the strength of
    // its own `native: true` would blank those windows until the client next
    // drew — for an app that redraws on input, that is until the user does
    // something.
    const element = mountApp("term");
    element.drawFrame(2, 1, 1, new Uint8Array(8));

    frames.turn();

    expect(element.querySelector("canvas")).not.toBeNull();
  });

  it("takes a frame that arrives after the host took the window", () => {
    // The message is ordered behind the frames on the same socket, so pixels
    // arriving after it are a window that has gone back to the copy path — not
    // a straggler to ignore. Refusing them would leave that window blank.
    const element = mountApp("term");
    element.drawFrame(2, 1, 1, new Uint8Array(8));
    element.dropSurface();

    element.drawFrame(2, 1, 1, new Uint8Array(8));

    expect(element.querySelector("canvas")).not.toBeNull();
  });

  it("drops the copied pixels when the element changes which app it shows", () => {
    // They are the previous app's last frame, and the element now stands for
    // another. The host cannot correct this: `app_composited` is only sent for
    // a window whose pixels it sent, and it never sent these under the new
    // name — so the stale frame would sit over the new app's live window for
    // as long as the element existed.
    const element = mountApp("term");
    element.drawFrame(2, 1, 1, new Uint8Array(8));

    element.setAttribute("app-id", "editor");

    expect(element.querySelector("canvas")).toBeNull();
  });

  it("drops the copied pixels when it tells the host to stop compositing", () => {
    // A disconnect is not always a teardown: moving an element between two
    // containers is a disconnect *and* a reconnect, and children survive the
    // move. An element that kept its canvas here would be holding pixels the
    // host has been told it does not hold — and the host only ever sends the
    // message that clears a canvas to a window whose pixels it sent, so a
    // window moved while copied and re-placed as native wears a still of
    // itself for good.
    const parent = document.createElement("div");
    document.body.append(parent);
    const element = mountApp("term");
    element.drawFrame(2, 1, 1, new Uint8Array(8));

    parent.append(element);

    expect(element.querySelector("canvas")).toBeNull();
  });

  it("sends a placement again when the host never received the last one", () => {
    // Recording the key before the send would leave the element sure it had
    // reported a placement that never arrived — and because the record is what
    // suppresses the next one, nothing would ever send it again until
    // something else about the window changed.
    const moved = { transform: [1, 0, 0, 1, 0, 0] as Matrix };
    registerElements(bridge as unknown as BridgeClient, {
      measure: (element) => ({ ...stubMeasure(element), ...moved }),
      observePlacement: frames.observe,
    });
    mountApp("term");
    const placePortal = bridge.placePortal.bind(bridge);
    bridge.placePortal = () => {
      throw new Error("the socket went away");
    };

    moved.transform = [1, 0, 0, 1, 40, 5];
    expect(() => {
      frames.turn();
    }).toThrow("the socket went away");
    bridge.placePortal = placePortal;
    bridge.calls.length = 0;
    frames.turn();

    expect(bridge.calls).toContainEqual([
      "place",
      {
        appId: "term",
        cornerRadius: 0,
        native: true,
        opacity: 1,
        size: [10, 20],
        transform: [1, 0, 0, 1, 40, 5],
        visible: true,
        zIndex: 0,
      },
    ]);
  });

  it("configures a client again when the host never received the last size", () => {
    // The same hazard on the other record, and it is cleared on different
    // paths from the placement — so one test cannot stand in for both.
    const box = { size: [10, 20] as Point };
    registerElements(bridge as unknown as BridgeClient, {
      measure: (element) => ({ ...stubMeasure(element), ...box }),
      observePlacement: frames.observe,
    });
    mountApp("term");
    const resizeApp = bridge.resizeApp.bind(bridge);
    bridge.resizeApp = () => {
      throw new Error("the socket went away");
    };

    box.size = [30, 40];
    expect(() => {
      frames.turn();
    }).toThrow("the socket went away");
    bridge.resizeApp = resizeApp;
    bridge.calls.length = 0;
    frames.turn();

    expect(bridge.calls).toContainEqual(["resize", "term", [30, 40]]);
  });

  it("tells a newly shown app its size even if it was swapped in detached", () => {
    // `attributeChangedCallback` cannot run while the element is out of the
    // page, so nothing gets the chance to clear anything by hand on this path.
    // A chrome that parks an element, re-points it and puts it back would
    // otherwise leave the new client never configured, drawing at whatever
    // size the previous one had asked for.
    const element = mountApp("term");
    const parent = document.createElement("div");
    document.body.append(parent);

    element.remove();
    element.setAttribute("app-id", "editor");
    bridge.calls.length = 0;
    parent.append(element);

    expect(bridge.calls).toContainEqual(["resize", "editor", [10, 20]]);
  });

  it("re-places a window whose app-id was taken away and given back", () => {
    // Removing the attribute tells the host to forget the portal but places
    // nothing in its stead — there is no app to place. Putting the same id
    // back is then a placement the element has already sent once, so a record
    // that survived the removal would deduplicate it away and the window would
    // never return to the scene.
    const element = mountApp("term");
    element.removeAttribute("app-id");
    bridge.calls.length = 0;

    element.setAttribute("app-id", "term");

    expect(bridge.calls.some(([kind]) => kind === "place")).toBe(true);
  });

  it("tells a newly shown app what size to render at", () => {
    // The render size carries no app id, so an element that swapped `app-id`
    // while keeping its box would never configure the new client — it would
    // draw at whatever the previous one happened to be until the element next
    // resized, which for a window that fills the stage is never.
    const element = mountApp("term");
    bridge.calls.length = 0;

    element.setAttribute("app-id", "editor");

    expect(bridge.calls).toContainEqual(["resize", "editor", [10, 20]]);
  });

  it("forgets the client's resolution when it changes which app it shows", () => {
    // The recorded surface size is what pointer coordinates are scaled
    // through. Left at the previous app's resolution it maps every click on
    // the new one through the wrong surface — and unlike the canvas, nothing
    // about the picture looks wrong while it does.
    // stubMeasure lays the element out at 10x20 and `term` renders at twice
    // that, so its surface coordinates are double the element's — which is
    // what makes the two answers tell each other apart.
    const element = mountApp("term");
    element.drawFrame(40, 80, 2, new Uint8Array(40 * 80 * 4));

    element.setAttribute("app-id", "editor");
    element.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 5, clientY: 10 }),
    );

    // One to one, because nothing is known about `editor` yet. Through
    // `term`'s resolution it would have been (10, 20).
    expect(bridge.calls).toContainEqual(["motion", "editor", 5, 10]);
  });

  it("keeps the client's resolution when the host takes the window over", () => {
    // The same window, drawn by the compositor instead: the client is still
    // rendering at the resolution it reported, so forgetting it here would
    // break the pointer for every window that went native.
    const element = mountApp("term");
    element.drawFrame(40, 80, 2, new Uint8Array(40 * 80 * 4));

    element.dropSurface();
    element.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 5, clientY: 10 }),
    );

    // Still through the 20x40 the client renders at. Forgotten, it would map
    // one to one and report (5, 10).
    expect(bridge.calls).toContainEqual(["motion", "term", 10, 20]);
  });

  it("keeps the placeholder down after the copied pixels go", () => {
    // `has-surface` says this element has a window behind it, which is as true
    // when the compositor draws it as when a canvas does. Putting the "app
    // surface: …" placeholder back would draw it over a live window.
    const element = mountApp("term");
    element.drawFrame(2, 1, 1, new Uint8Array(8));

    element.dropSurface();

    expect(element.classList.contains("has-surface")).toBe(true);
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
