// Alt, and the pointer: the whole user interface of this shell.
//
// Hold Alt and drag a window to move it, or drag with the secondary button to
// resize it from its bottom right corner; either way it comes to the front.
// That is TinyWM's bargain, and it is here for TinyWM's reason — it needs no
// title bars, no borders and no widgets, so the desktop can be nothing but the
// windows on it.
//
// The listeners run in the capture phase and stop what they take, because a
// `<domicile-app>` forwards every pointer event over it straight to the client
// underneath. Without that a moved window would also have been clicked and
// dragged in, and the client would be left holding a button that never came up.

import type { Desktop } from "./desktop";
import type { PointerPosition } from "./drag";
import { Drag, dragTo } from "./drag";
import type { WindowBox } from "./window-box";

/** The pointer button that resizes rather than moves. */
const SECONDARY_BUTTON = 2;

/** What a gesture needs of the desktop; a `Desktop` satisfies it. */
export type Windows = Pick<
  Desktop,
  "appIdAt" | "boxOf" | "onWindowClosed" | "place" | "raise"
>;

/**
 * Let Alt-drags move, resize and raise the windows on `desktop`.
 *
 * `root` is the desktop element the windows are in. It sees every event over
 * one in the capture phase, and it takes the pointer for the length of a drag,
 * so a gesture that wanders off its window — or off the page — still ends
 * where the user let go.
 */
export const installWindowGestures = (
  root: HTMLElement,
  desktop: Windows,
): void => {
  // The drag in progress, if one is. Genuinely mutable state shared by the
  // listeners — a press starts it, a move reads it, a release ends it — so it
  // is a binding they close over rather than something passed.
  let dragging: { appId: string; drag: Drag; pointerId: number } | undefined;

  // Every way out of a drag is the same two things: the window stops following
  // the pointer, and the pointer goes back to whatever is under it.
  //
  // The release needs no guard, and the pointer is an argument rather than
  // something read back off `dragging` to say why: this is only ever called
  // while a drag is running, and a running drag means a pointer that is still
  // down. `releasePointerCapture` throws for a pointer that is *not* active —
  // an element that simply has no capture is a quiet no-op — so a live drag is
  // exactly the condition that makes it safe.
  //
  // Not something the suite can vouch for: happy-dom models pointer capture as
  // a bare set of ids, with no active-pointer set and no throw to reach. Green
  // here is silent about this.
  const endDrag = (pointerId: number): void => {
    root.releasePointerCapture(pointerId);
    dragging = undefined;
  };

  // A client exits when it likes, including while its window is being dragged.
  // Left alone, the drag goes on naming a window the desktop has taken down,
  // and asks it to place that window on every further pointer sample — which
  // `Desktop` answers, rightly, by throwing.
  desktop.onWindowClosed((appId) => {
    if (dragging !== undefined && dragging.appId === appId) {
      endDrag(dragging.pointerId);
    }
  });

  root.addEventListener(
    "pointerdown",
    (event) => {
      const appId = event.altKey ? desktop.appIdAt(event.target) : undefined;
      if (appId !== undefined) {
        take(event);
        desktop.raise(appId);
        dragging = {
          appId,
          drag: dragFor(event.button, desktop.boxOf(appId), positionOf(event)),
          pointerId: event.pointerId,
        };
        // Every later event for this pointer is delivered here, whatever it is
        // over, and the browser guarantees a `pointerup` or a `pointercancel`
        // to match this press. Without it a release outside the page is a
        // release this never hears, and the window follows the bare cursor
        // around the desktop until the user presses over a window again.
        root.setPointerCapture(event.pointerId);
      }
    },
    { capture: true },
  );

  root.addEventListener(
    "pointermove",
    (event) => {
      if (dragging !== undefined) {
        take(event);
        desktop.place(dragging.appId, dragTo(dragging.drag, positionOf(event)));
      }
    },
    { capture: true },
  );

  const release = (event: PointerEvent): void => {
    if (dragging !== undefined) {
      // Taken as well: the client was never told the button went down, so it
      // must not be told it came up either.
      take(event);
      endDrag(dragging.pointerId);
    }
  };
  root.addEventListener("pointerup", release, { capture: true });
  // The release that never comes. The browser takes a pointer away mid-gesture
  // — a touch turning into a scroll, a device going away — and sends this
  // instead of a `pointerup`, which is the one case pointer capture cannot
  // cover because capture is what it is cancelling.
  root.addEventListener("pointercancel", release, { capture: true });
};

/** The secondary button drags the corner; anything else drags the window. */
const dragFor = (
  button: number,
  box: WindowBox,
  from: PointerPosition,
): Drag =>
  button === SECONDARY_BUTTON ? Drag.Resize(box, from) : Drag.Move(box, from);

/** Where the pointer is, in the coordinates a window's box is written in. */
const positionOf = (event: PointerEvent): PointerPosition => ({
  x: event.clientX,
  y: event.clientY,
});

/** This event is the desktop's; nothing below it hears about it. */
const take = (event: PointerEvent): void => {
  event.preventDefault();
  event.stopPropagation();
};
