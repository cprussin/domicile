import { beforeEach, describe, expect, it } from "bun:test";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
} from "@domicile/chrome-sdk/register-elements";

import { Desktop } from "./desktop";
import { installWindowGestures } from "./window-gestures";

const stubMeasure: Measure = () => ({
  cornerRadius: 0,
  native: true,
  opacity: 1,
  shadow: undefined,
  size: [100, 100],
  takesPointer: true,
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
  zIndex: 0,
});

/** The pointer every gesture here is made with. */
const POINTER = 1;

/** The button a chrome moves a window with, and the one it resizes with. */
const PRIMARY = 0;
const SECONDARY = 2;

/** The evdev code for the left mouse button, as the SDK reports it. */
const BTN_LEFT = 272;

/**
 * What the elements forwarded to the clients underneath them.
 *
 * The assertion that matters is on this rather than on `defaultPrevented`: what
 * keeps a press from a client is `stopPropagation`, and the SDK's forwarder
 * never looks at whether the default was prevented — so a test watching the
 * flag would stay green with the propagation taken out.
 */
type Forwarded = { buttons: unknown[][]; motions: unknown[][] };

type Gesture = { alt?: boolean; button?: number; x: number; y: number };

const pointer = (
  type: string,
  target: EventTarget,
  { alt = true, button = PRIMARY, x, y }: Gesture,
): void => {
  target.dispatchEvent(
    new PointerEvent(type, {
      altKey: alt,
      bubbles: true,
      button,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: POINTER,
    }),
  );
};

/** A desktop with `appIds` open on it, and the gestures installed. */
const desktopWith = (
  ...appIds: readonly string[]
): { desktop: Desktop; forwarded: Forwarded; root: HTMLElement } => {
  const forwarded: Forwarded = { buttons: [], motions: [] };
  registerElements(recordingBridge(forwarded), {
    measure: stubMeasure,
    // Otherwise these suites run the SDK's own animation loop, which happy-dom
    // serves as fast as it can.
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window moves on
      // its own.
    },
  });
  const root = document.createElement("div");
  document.body.append(root);
  const desktop = new Desktop(root);
  installWindowGestures(root, desktop);
  for (const appId of appIds) {
    desktop.open(appId, [640, 480]);
  }
  return { desktop, forwarded, root };
};

// The elements report their box, and forward the pointer events the desktop
// does *not* take, to a bridge. Only the forwards are read back.
const recordingBridge = (forwarded: Forwarded): BridgeClient =>
  ({
    focusApp: () => undefined,
    focusChrome: () => undefined,
    placePortal: () => undefined,
    pointerButton: (...call: unknown[]) => forwarded.buttons.push(call),
    pointerMotion: (...call: unknown[]) => forwarded.motions.push(call),
    removePortal: () => undefined,
    resizeApp: () => undefined,
  }) as unknown as BridgeClient;

const windowFor = (root: HTMLElement, appId: string): HTMLElement => {
  const element = root.querySelector(`${APP_TAG_NAME}[app-id="${appId}"]`);
  if (element instanceof HTMLElement) {
    return element;
  } else {
    throw new Error(`test: the desktop is showing no window for ${appId}`);
  }
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe("installWindowGestures", () => {
  it("carries a window with an Alt-drag", () => {
    const { desktop, root } = desktopWith("term");
    const term = windowFor(root, "term");
    const before = desktop.boxOf("term");

    pointer("pointerdown", term, { x: 300, y: 300 });
    pointer("pointermove", term, { x: 340, y: 330 });

    expect(desktop.boxOf("term")).toStrictEqual({
      ...before,
      left: before.left + 40,
      top: before.top + 30,
    });
    // The drag holds the pointer for its whole length, which is what keeps one
    // that wanders off its window — or off the page — ending where the user let
    // go rather than never ending at all.
    expect(root.hasPointerCapture(POINTER)).toBe(true);
  });

  it("resizes with the secondary button instead of moving", () => {
    const { desktop, root } = desktopWith("term");
    const term = windowFor(root, "term");
    const before = desktop.boxOf("term");

    pointer("pointerdown", term, { button: SECONDARY, x: 300, y: 300 });
    pointer("pointermove", term, { button: SECONDARY, x: 340, y: 330 });

    expect(desktop.boxOf("term")).toStrictEqual({
      ...before,
      height: before.height + 30,
      width: before.width + 40,
    });
  });

  it("raises the window the drag started in", () => {
    const { root } = desktopWith("term", "editor");
    pointer("pointerdown", windowFor(root, "term"), { x: 10, y: 10 });
    expect(Number(windowFor(root, "term").style.zIndex)).toBeGreaterThan(
      Number(windowFor(root, "editor").style.zIndex),
    );
  });

  it("tells the client nothing about a drag the desktop took", () => {
    // A `<domicile-app>` forwards every pointer event over it straight to the
    // client underneath. Alt is the desktop's, so a client whose window is
    // being dragged must hear none of it — a press it is told about and never
    // told the end of leaves it drawing a selection for the rest of the
    // session.
    const { forwarded, root } = desktopWith("term");
    const term = windowFor(root, "term");

    pointer("pointerdown", term, { x: 300, y: 300 });
    pointer("pointermove", term, { x: 340, y: 330 });
    pointer("pointerup", term, { x: 340, y: 330 });

    expect(forwarded).toStrictEqual({ buttons: [], motions: [] });
  });

  it("leaves a press without Alt to the client", () => {
    const { desktop, forwarded, root } = desktopWith("term");
    const term = windowFor(root, "term");
    const before = desktop.boxOf("term");

    pointer("pointerdown", term, { alt: false, x: 300, y: 300 });
    pointer("pointermove", term, { alt: false, x: 340, y: 330 });

    expect(forwarded.buttons).toStrictEqual([["term", BTN_LEFT, true]]);
    expect(forwarded.motions.length).toBeGreaterThan(0);
    expect(desktop.boxOf("term")).toStrictEqual(before);
  });

  it("lets the window go when the drag ends", () => {
    const { desktop, root } = desktopWith("term");
    const term = windowFor(root, "term");

    pointer("pointerdown", term, { x: 300, y: 300 });
    pointer("pointermove", term, { x: 340, y: 330 });
    const dropped = desktop.boxOf("term");
    pointer("pointerup", term, { x: 340, y: 330 });
    pointer("pointermove", term, { alt: false, x: 500, y: 500 });

    expect(desktop.boxOf("term")).toStrictEqual(dropped);
    // And gives the pointer back, so the next thing under it is clickable.
    expect(root.hasPointerCapture(POINTER)).toBe(false);
  });

  it("lets the window go when the drag is cancelled", () => {
    // A `pointercancel` is the release that never comes: the browser has taken
    // the pointer away mid-gesture. Without this the window follows the bare
    // cursor around the desktop — no button held, no Alt down — until the user
    // happens to press and release over a window again.
    const { desktop, root } = desktopWith("term");
    const term = windowFor(root, "term");

    pointer("pointerdown", term, { x: 300, y: 300 });
    const dropped = desktop.boxOf("term");
    pointer("pointercancel", term, { x: 300, y: 300 });
    pointer("pointermove", root, { alt: false, x: 900, y: 900 });

    expect(desktop.boxOf("term")).toStrictEqual(dropped);
  });

  it("drops a drag whose window has gone", () => {
    // A client exits when it likes, including while its window is being
    // dragged. The drag is then holding an app id the desktop no longer
    // answers for, and every further pointer sample would ask it to.
    const { desktop, forwarded, root } = desktopWith("term", "editor");

    pointer("pointerdown", windowFor(root, "term"), { x: 300, y: 300 });
    desktop.close("term");
    pointer("pointermove", windowFor(root, "editor"), {
      alt: false,
      x: 400,
      y: 400,
    });

    // The move reached the other window's client, which a drag still running
    // would have stopped before it got there.
    expect(forwarded.motions.length).toBeGreaterThan(0);
    expect(root.hasPointerCapture(POINTER)).toBe(false);
  });

  it("keeps dragging when some other client exits", () => {
    // Only the window being dragged ends the drag by leaving. Any client can
    // exit at any moment, and one doing so while the user is moving a
    // different window must not stop the window under their hand — a failure
    // with no symptom but the drag going dead with the button still held.
    const { desktop, root } = desktopWith("term", "editor");
    const before = desktop.boxOf("term");

    pointer("pointerdown", windowFor(root, "term"), { x: 300, y: 300 });
    desktop.close("editor");
    pointer("pointermove", windowFor(root, "term"), { x: 340, y: 330 });

    expect(desktop.boxOf("term")).toStrictEqual({
      ...before,
      left: before.left + 40,
      top: before.top + 30,
    });
  });

  it("ignores an Alt-drag that started on the bare desktop", () => {
    const { desktop, root } = desktopWith("term");
    const before = desktop.boxOf("term");

    pointer("pointerdown", root, { x: 300, y: 300 });
    pointer("pointermove", root, { x: 340, y: 330 });

    expect(desktop.boxOf("term")).toStrictEqual(before);
  });
});
