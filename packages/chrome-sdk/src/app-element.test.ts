import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { DomicileAppElement } from "./app-element";
import type { BridgeClient } from "./bridge";
import { BTN_LEFT } from "./input";
import type { Matrix, Point } from "./matrix";
import type { Measure } from "./measure";
import type { ObservePlacement } from "./observe-placement";
import { placementTiming } from "./placement-timing";
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
  takesPointer: true,
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

/**
 * What `drawFrame` put on the canvas, in a DOM that has no 2d context of its
 * own. The arguments are the whole behaviour worth pinning: a patch placed at
 * the wrong origin, or sized by the buffer rather than the region, draws a
 * window out of its own corner.
 *
 * The prototype rather than the instance, because the canvas is created inside
 * the very call under test — there is no instance to reach until afterwards.
 */
const recordDrawing = () => {
  const drawn: { x: number; y: number; width: number; height: number }[] = [];
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ({
    putImageData: (image: ImageData, x: number, y: number) => {
      drawn.push({ height: image.height, width: image.width, x, y });
    },
  })) as unknown as HTMLCanvasElement["getContext"];
  restoreContext = () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
  return drawn;
};

let restoreContext: (() => void) | undefined;

afterEach(() => {
  restoreContext?.();
  restoreContext = undefined;
});

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
        takesPointer: true,
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
        takesPointer: true,
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
        takesPointer: true,
        transform: [1, 0, 0, 1, 0, 0],
        visible: false,
        zIndex: 0,
      },
    ]);
    expect(bridge.calls.some(([kind]) => kind === "resize")).toBe(false);
  });

  it("tells the host when a window takes no pointer", () => {
    // The whole point of measuring it: the compositor routes the pointer by
    // hit-testing a rectangle, so a window the chrome painted a menu or a
    // browser tab over goes on swallowing the clicks meant for them until it
    // is told. Measured but not sent is the same as not measured.
    registerElements(bridge as unknown as BridgeClient, {
      measure: (element) => ({ ...stubMeasure(element), takesPointer: false }),
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
        size: [10, 20],
        takesPointer: false,
        transform: [1, 0, 0, 1, 0, 0],
        visible: true,
        zIndex: 0,
      },
    ]);
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
        takesPointer: true,
        transform: [1, 0, 0, 1, 40, 5],
        visible: true,
        zIndex: 0,
      },
    ]);
  });

  it("prices every measurement, not only the ones that send something", () => {
    // What costs is the measuring, and the measuring happens for every window
    // on every frame whether or not anything changed. A timing that only
    // counted the frames that moved a window would report an idle desktop as
    // free, which is exactly the claim in doubt.
    placementTiming.take();
    mountApp("term");
    const placing = placementTiming.take();

    frames.turn();
    frames.turn();
    const idling = placementTiming.take();

    expect(placing?.count).toBe(1);
    expect(idling?.count).toBe(2);
  });

  it("prices a measurement that threw, which has already cost the same", () => {
    // `readElementTransform` throws on a computed value it cannot parse, from
    // after the layout read. Priced only on success, such a window would cost
    // the desktop a measurement and contribute nothing to the number.
    //
    // This is the cheap case, and the throw is why: `connectedCallback` calls
    // `#place()` before it subscribes to the animation loop, so a window that
    // throws at mount never joins the loop at all and is measured exactly
    // once. It costs that one measurement, which is what the count below
    // pins. (Re-appending the element runs `connectedCallback` again, and
    // pays again.)
    //
    // Nothing catches the throw either way. `mountApp` propagating it here is
    // happy-dom rather than a browser — the DOM spec has a custom element
    // reaction that throws *reported* rather than rethrown to whoever appended
    // the element — so the assertion that matters is the count below.
    registerElements(bridge as unknown as BridgeClient, {
      measure: () => {
        throw new Error("a window the SDK could not measure");
      },
      observePlacement: frames.observe,
    });
    placementTiming.take();

    expect(() => {
      mountApp("term");
    }).toThrow("a window the SDK could not measure");

    expect(placementTiming.take()?.count).toBe(1);
  });

  it("keeps pricing a window that starts throwing after it was mounted", () => {
    // The case that costs a desktop something: a window measured fine at mount
    // and then given, by a class toggle, a computed transform the SDK cannot
    // parse. The loop keeps calling it every frame for the life of the page —
    // deliberately, so that one bad window does not stop the others — so it
    // pays the layout read sixty times a second forever. The test above is
    // the cheap counterpart: a window that was already throwing at mount never
    // joined the loop, so it costs one measurement rather than every frame's.
    mountApp("term");
    registerElements(bridge as unknown as BridgeClient, {
      measure: () => {
        throw new Error("a window the SDK could not measure");
      },
      observePlacement: frames.observe,
    });
    placementTiming.take();

    expect(() => {
      frames.turn();
    }).toThrow("a window the SDK could not measure");
    // A second frame, because "keeps" is the whole claim. One frame would pass
    // just as well if the throw had unfollowed the element — which would make
    // this the cheap case rather than the expensive one it is named for. It is
    // the element that would have to do that unfollowing: `tick` reschedules
    // regardless, and `#unobserve` is only reached from `disconnectedCallback`.
    expect(() => {
      frames.turn();
    }).toThrow("a window the SDK could not measure");

    expect(placementTiming.take()?.count).toBe(2);
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
        takesPointer: true,
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

  it("sizes the copied pixels to the element, not to the buffer", () => {
    // A canvas has no size of its own beyond its backing store, and the
    // backing store is the client's *device* pixels. Left alone on a 2x
    // display that is a window drawn at twice its element — the copy path and
    // the native path showing the same window at different sizes, which is
    // what a shell author sees and cannot explain. `display` because a canvas
    // is inline by default, and an inline box sits on the text baseline with a
    // descender's gap beneath it.
    const element = mountApp("term");

    element.drawFrame(2, 1, 1, new Uint8Array(8));

    const canvas = element.querySelector("canvas");
    expect(canvas?.style.inlineSize).toBe("100%");
    expect(canvas?.style.blockSize).toBe("100%");
    expect(canvas?.style.display).toBe("block");
  });

  it("draws a partial frame where the host said it goes", () => {
    // The copy path's cost is bytes, so a client that changed a cursor cell
    // sends a cursor cell. Placing it wrong is not a subtle failure: the patch
    // lands at the canvas origin and the window is drawn from its own top-left
    // corner outwards.
    const element = mountApp("term");
    const drawn = recordDrawing();

    element.drawFrame(4, 3, 1, new Uint8Array(48));
    element.drawFrame(4, 3, 1, new Uint8Array(2 * 2 * 4), [1, 1, 2, 2]);

    expect(drawn).toStrictEqual([
      { height: 3, width: 4, x: 0, y: 0 },
      { height: 2, width: 2, x: 1, y: 1 },
    ]);
  });

  it("sizes a partial frame's pixels by the region, not the buffer", () => {
    // `ImageData` reads `width * height * 4` bytes, so a region's patch built
    // at the buffer's width runs off the end of the bytes that arrived.
    const element = mountApp("term");
    const drawn = recordDrawing();

    element.drawFrame(400, 300, 1, new Uint8Array(2 * 2 * 4), [8, 9, 2, 2]);

    expect(drawn).toStrictEqual([{ height: 2, width: 2, x: 8, y: 9 }]);
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

  it("says it has a window behind it once the compositor has taken one", () => {
    // A window the compositor drew from the start never sends a copied frame,
    // so nothing ever put `has-surface` on: the shell's placeholder — "app
    // surface: <id>" — is still painted, over a live window. The class says
    // this element has a window behind it, which is as true when the
    // compositor draws it as when a canvas does.
    const element = mountApp("term");
    expect(element.classList.contains("has-surface")).toBe(false);

    element.dropSurface();

    expect(element.classList.contains("has-surface")).toBe(true);
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
        takesPointer: true,
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
    // Released, because a key left down is left down for the whole suite: the
    // page holds it until its release, which is the point of the tests below.
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

  it("releases a key wherever the keyboard went between its press and its release", () => {
    // The compositor's xkb state outlives every window, and it only unlocks a
    // lock key on the release of the press it saw lock it. Under
    // `caps:swapescape` the physical Escape key *is* Caps_Lock (evdev 1), so a
    // press forwarded without its release latches capitals into every Wayland
    // client there will ever be — no later press of that key can clear it,
    // while the page's own webviews, which never touch that state, keep
    // typing normally.
    const element = mountApp("term");
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
    );
    bridge.calls.length = 0;

    // The keyboard goes back to the chrome while the key is still down.
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, code: "Escape" }),
    );

    expect(bridge.calls).toContainEqual(["key", "term", 1, false]);
  });

  it("releases what it is holding when the page loses the keyboard", () => {
    // A window the user alt-tabs away from is never told the key came up, so
    // the release has to be sent on the way out. Otherwise the key is held
    // down in the compositor for as long as the desktop runs.
    const element = mountApp("term");
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
    );
    bridge.calls.length = 0;

    globalThis.window.dispatchEvent(new Event("blur"));

    expect(bridge.calls).toEqual([["key", "term", 1, false]]);
  });

  it("releases onto the bridge that is connected now", () => {
    // The release is for the compositor's sake — its seat is what holds the
    // key down — so it belongs on the connection to that compositor, not on
    // whichever bridge object happened to be bound when the key went down.
    const element = mountApp("term");
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
    );
    const rebound = new FakeBridge();
    registerElements(rebound as unknown as BridgeClient, {
      measure: stubMeasure,
      observePlacement: frames.observe,
    });
    bridge.calls.length = 0;

    document.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, code: "Escape" }),
    );

    expect(rebound.calls).toEqual([["key", "term", 1, false]]);
    expect(bridge.calls).toEqual([]);
  });

  it("releases what it is holding when the page goes away", () => {
    // A reload never delivers the keyup, and blur is not what fires when the
    // page is navigated away from.
    const element = mountApp("term");
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
    );
    bridge.calls.length = 0;

    globalThis.window.dispatchEvent(new Event("pagehide"));

    expect(bridge.calls).toEqual([["key", "term", 1, false]]);
  });

  it("does not release a key it never forwarded a press for", () => {
    // Pressed while the chrome had the keyboard: the client never saw the key
    // go down, and a release for it is a key event that never happened.
    const element = mountApp("term");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
    );
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    bridge.calls.length = 0;

    document.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, code: "Escape" }),
    );

    expect(bridge.calls).toEqual([]);
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
