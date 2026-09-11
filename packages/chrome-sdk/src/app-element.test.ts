import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { AppFocusRequest, DomicileAppElement } from "./app-element";
import { APP_FOCUS_REQUESTED_EVENT } from "./app-element";
import type { BridgeClient } from "./bridge";
import { BTN_LEFT } from "./input";
import type { Matrix, Point } from "./matrix";
import type { Measure } from "./measure";
import type { ObservePlacement } from "./observe-placement";
import { placementTiming } from "./placement-timing";
import { APP_TAG_NAME, registerElements } from "./register-elements";

type Call = readonly [kind: string, ...args: unknown[]];

// A double for the bridge, capturing the size reports and input calls the
// elements make. Only the surface the elements use is implemented.
class FakeBridge {
  readonly calls: Call[] = [];

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
 * Install a fake `canvas.embedExternalSurface`, as the forked engine provides
 * it, and record what each canvas was asked to embed.
 *
 * On the prototype rather than on an instance: the canvas is created inside the
 * call under test, so there is nothing to reach until afterwards.
 */
const recordEmbeds = (): string[] => {
  const embedded: string[] = [];
  HTMLCanvasElement.prototype.embedExternalSurface = (appId: string) => {
    embedded.push(appId);
    return Promise.resolve();
  };
  restoreEmbed = () => {
    delete HTMLCanvasElement.prototype.embedExternalSurface;
  };
  return embedded;
};

/** As above, but the engine refuses — the case a live window fails on. */
const refuseEmbeds = (why: string): void => {
  HTMLCanvasElement.prototype.embedExternalSurface = () =>
    Promise.reject(new Error(why));
  restoreEmbed = () => {
    delete HTMLCanvasElement.prototype.embedExternalSurface;
  };
};

let restoreEmbed: (() => void) | undefined;

afterEach(() => {
  restoreEmbed?.();
  restoreEmbed = undefined;
});

describe("<domicile-app>", () => {
  let bridge: FakeBridge;
  let frames: FakeFrames;
  // A shell listens for focus requests on `document` rather than per window,
  // so those listeners outlive the element that was clicked and the body this
  // empties between tests. Aborting is what takes them off again.
  let shell: AbortController;

  beforeEach(() => {
    document.body.innerHTML = "";
    bridge = new FakeBridge();
    frames = new FakeFrames();
    shell = new AbortController();
    registerElements(bridge as unknown as BridgeClient, {
      measure: stubMeasure,
      observePlacement: frames.observe,
    });
  });

  afterEach(() => {
    shell.abort();
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
      }),
      observePlacement: frames.observe,
    });
    mountApp("term");

    expect(bridge.calls.some(([kind]) => kind === "resize")).toBe(false);
  });

  it("prices every measurement, not only the ones that send something", () => {
    // What costs is the measuring, and the measuring happens for every window
    // on every frame whether or not anything changed. A timing that only
    // counted the frames that resized a window would report an idle desktop
    // as free, which is exactly the claim in doubt.
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
    // `#reportSize()` before it subscribes to the loop, so a window that
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

  it("says nothing about a window that did not change size", () => {
    // Measuring happens on every animation frame, so a window that is simply
    // sitting there would otherwise configure its client sixty times a second
    // — down a socket shared with every client's pixels, and a client redraws
    // every time it is configured.
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

  it("configures the client again when the element's box changes", () => {
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

  it("exposes appId as a property", () => {
    const element = document.createElement(APP_TAG_NAME) as DomicileAppElement;
    element.setAttribute("app-id", "term");
    expect(element.appId).toBe("term");
  });

  it("stops claiming a window behind it when the element swaps app-id", () => {
    // `has-surface` says this element has something behind it, and after a swap
    // it does not: the previous app's canvas is gone and the new client has not
    // reported a size yet. A shell hangs its "app surface: <id>" placeholder off
    // the class's absence, so leaving it on hides the placeholder over nothing.
    const element = mountApp("term");
    element.setSurfaceSize(800, 600);
    expect(element.classList.contains("has-surface")).toBe(true);

    element.setAttribute("app-id", "editor");

    expect(element.classList.contains("has-surface")).toBe(false);
  });

  it("configures a client again when the host never received the last size", () => {
    // Recording the key before the send would leave the element sure it had
    // reported a size that never arrived — and because the record is what
    // suppresses the next one, nothing would send it again until the window
    // changed size.
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

  it("shows again a window whose app-id was taken away and given back", () => {
    // Removing the attribute drops the canvas, because it is showing a window
    // this element has stopped standing for. Nothing else puts one back: the
    // embed runs from `connectedCallback`, which does not run again for an
    // element that never left the page, so the window would be gone for good.
    const embedded = recordEmbeds();
    const element = mountApp("term");
    element.removeAttribute("app-id");
    expect(element.querySelector("canvas")).toBeNull();

    element.setAttribute("app-id", "term");

    expect(embedded).toStrictEqual(["term", "term"]);
  });

  it("embeds the new app's surface when the element swaps app-id", () => {
    // The canvas is torn down on a swap because it holds the *previous* app's
    // window, and nothing but this puts one back: the embed runs from
    // `connectedCallback`, which a swap does not re-run. Without it the
    // element that swapped shows nothing for as long as it is open.
    const embedded = recordEmbeds();
    const element = mountApp("term");
    expect(embedded).toStrictEqual(["term"]);

    element.setAttribute("app-id", "editor");

    expect(embedded).toStrictEqual(["term", "editor"]);
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

  it("drops the placeholder as soon as the client has a size", () => {
    // Where the compositor draws the client's surface itself no pixels ever
    // reach the element, so a placeholder that waited for them would stay up —
    // and be drawn by the page *over* the window it is standing in for.
    const element = mountApp("term");
    expect(element.classList.contains("has-surface")).toBe(false);

    element.setSurfaceSize(800, 600);

    expect(element.classList.contains("has-surface")).toBe(true);
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

    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );

    expect(requests).toStrictEqual(["term"]);
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

    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );

    expect(bridge.calls).not.toContainEqual(["focusApp", "term"]);
    // The click itself still belongs to the client: what the shell refused is
    // the keyboard, not the button the user pressed.
    expect(bridge.calls).toContainEqual(["button", "term", BTN_LEFT, true]);
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

  describe("showing the client's window", () => {
    it("embeds the surface the app id names", () => {
      // The whole of how a client's pixels reach the page. The compositor
      // submits the client's own buffer to a frame sink brokered under this
      // app id, and this is what points the canvas's layer at it.
      const embedded = recordEmbeds();

      mountApp("terminal");

      expect(embedded).toStrictEqual(["terminal"]);
    });

    it("gives each element its own window", () => {
      // A desktop is several windows. Passing the app id is what stops every
      // element embedding whichever surface was brokered last — one client
      // drawn in every window, with nothing anywhere reporting an error.
      const embedded = recordEmbeds();

      mountApp("terminal");
      mountApp("editor");

      expect(embedded).toStrictEqual(["terminal", "editor"]);
    });

    it("embeds nothing for an element with no app id", () => {
      // An element that names no window is not asking for one. Embedding here
      // is what would hand it somebody else's.
      const embedded = recordEmbeds();

      mountApp();

      expect(embedded).toStrictEqual([]);
    });

    it("takes the canvas away when the element is torn down", () => {
      // The element has stopped standing for that window, so it must stop
      // showing one. A disconnect is not always a teardown — moving an element
      // between two containers is a disconnect and a reconnect — and the
      // reconnect embeds again.
      const embedded = recordEmbeds();
      const element = mountApp("terminal");
      expect(embedded).toHaveLength(1);

      element.remove();

      expect(element.querySelector("canvas")).toBeNull();
    });

    it("mounts without a canvas where the engine has no such call", () => {
      // A chrome on stock Chromium or Electron. The element still lays out and
      // still reports its size — a shell is written against the same seam —
      // and shows nothing rather than throwing.
      const element = mountApp("terminal");

      expect(element.querySelector("canvas")).toBeNull();
    });
  });
});

// A REFUSED EMBED USED TO BE SWALLOWED WHOLE, and the comment that did it said
// why: both ways it can reject "are this element being torn down, and neither
// is worth reporting". That is checkable, and it is false. An element still in
// the document when the refusal lands is not being torn down — it is a window
// that will show `app surface: …` over a running client for as long as it is
// open, with nothing in any log. Observed on a real desktop: a terminal moved
// into a floating window went to the placeholder and stayed there.
//
// So the teardown case stays silent and the other one talks. The two are told
// apart by the only thing that distinguishes them, which is whether the
// element is still connected when the answer arrives.
/**
 * What the SDK said on `console.error` while `act` ran, and nothing else.
 *
 * The same shape as `warningsFrom` above, for the same reason: the report is
 * the behaviour under test, so it has to be captured rather than suppressed.
 */
const errorsWhile = async (act: () => void): Promise<string[]> => {
  const said: string[] = [];
  // biome-ignore lint/suspicious/noConsole: capturing what the SDK reports
  const original = console.error;
  console.error = (...args: unknown[]) => {
    said.push(args.join(" "));
  };
  try {
    act();
    // Two turns: one for the rejection to settle, one for the handler on it.
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.error = original;
  }
  return said;
};

// A REFUSED EMBED USED TO BE SWALLOWED WHOLE, and the comment that did it said
// why: both ways it can reject "are this element being torn down, and neither
// is worth reporting". That is checkable, and it is false. An element still in
// the document when the refusal lands is not being torn down — it is a window
// that will show `app surface: …` over a running client for as long as it is
// open, with nothing in any log. Observed on a real desktop: a terminal moved
// into a floating window went to the placeholder and stayed there.
//
// So the teardown case stays silent and the other one talks. The two are told
// apart by the only thing that distinguishes them, which is whether the
// element is still connected when the answer arrives.
describe("a refused surface", () => {
  it("says so when the element is still in the document", async () => {
    refuseEmbeds("already has a surface");
    let element: HTMLElement | undefined;
    const said = await errorsWhile(() => {
      element = mountApp("app-1");
    });
    expect(element?.isConnected).toBe(true);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("app-1");
  });

  it("stays silent for an element that has gone away", async () => {
    refuseEmbeds("the element went away");
    const said = await errorsWhile(() => {
      mountApp("app-1").remove();
    });
    expect(said).toHaveLength(0);
  });
});
