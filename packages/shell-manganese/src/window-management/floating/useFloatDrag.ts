import type { Display } from "@domicile/component-library/display-source";
import { offThePage } from "@domicile/component-library/on-the-page";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { Float } from "./float";

/**
 * A drag in progress: everything about it that was settled when the window was
 * taken hold of.
 *
 * The callbacks are latched here with the box for one reason rather than two:
 * they are what this drag does, and a drag is what it was when it started.
 * Keeping them here is also what lets the listeners below be attached once and
 * never rebuilt, so no part of a drag depends on a render having happened.
 */
type Drag = {
  /** The window's box when it was taken hold of, which the delta is from. */
  box: Float;
  /** The screen it is being dragged over, which says what a delta is worth. */
  display: Display;
  from: { x: number; y: number };
  onDrop: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  resizes: boolean;
};

/**
 * The secondary button, which resizes whatever it takes hold of.
 *
 * The other way to a resize, and the one that needs no second modifier held:
 * whatever handed the pointer to the shell, the right button means the corner
 * rather than the whole window.
 */
const SECONDARY_BUTTON = 2;

export type FloatDrag = {
  /** Whether a drag is running, and whether it is resizing rather than moving. */
  drag: { resizes: boolean } | undefined;
  /**
   * Swallow the menu the secondary button would otherwise open.
   *
   * The right button is a resize here, and a context menu over the window
   * being resized is the browser answering a press the desktop has taken.
   */
  onContextMenu: (event: { preventDefault: () => void }) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Options = {
  /**
   * The screen the window is on, which is the one the chrome is on.
   *
   * Here because a pointer's numbers mean nothing without it — see the note on
   * units below.
   */
  display: Display;
  float: Float;
  onDrop: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  /**
   * Whether taking hold now would resize the window rather than move it.
   *
   * Read when the drag starts and then kept: letting go of Shift half way
   * through a resize must not turn it into a move, with the window jumping to
   * wherever the pointer has got to.
   */
  resizes: boolean;
};

/**
 * Turning pointer events into where a floating window ends up.
 *
 * Shared because a window has two things to drag it by and they are the same
 * drag: the sheet that catches a Meta+drag anywhere over it, and the title bar
 * that catches an ordinary one. What differs is where the pointer is allowed
 * to land, which is a matter of which element carries the press.
 *
 * **Only the press is the element's. The rest of the drag is the window's.**
 * A drag that reads its moves off the element it started on ends wherever that
 * element stops receiving them, and the pointer leaves it constantly: over the
 * window in front, over the top bar, off the edge of the screen.
 * `setPointerCapture` is the usual answer and is still set below, but it is
 * not one to rely on here — a browser releases capture when the capturing
 * element is moved in the document, and taking hold of a window raises it.
 * Listening on `window` is what makes the release arrive from wherever it
 * happens, and a drag that cannot be ended leaves its window see-through,
 * click-through, and following the pointer for ever.
 *
 * **The pointer's pixels are not the window's.** A `PointerEvent` reports
 * where the pointer is on the page, and a float is laid out in the desktop's
 * logical pixels — which are the same numbers only where the page is the whole
 * desktop. Where the engine scans out, the page IS one monitor and `<Screen>`
 * covers it with a transform, so a hand that crossed 120 of the page's pixels
 * crossed 60 of the ones the window was placed at, and sideways to them on a
 * monitor on its side. A drag that added the event's own numbers moved the
 * window out from under the hand holding it; `offThePage` is what the travel
 * goes through, and `pointer-warp.ts` is the same seam in the other direction.
 *
 * **The drag is a ref, and the state beside it is only what to draw.** A
 * pointer sequence is answered synchronously and a render is not: `setState`
 * schedules, so a handler built by a render sees whatever the drag was when
 * that render was built, and a press and a release inside one — a click —
 * would drop nothing at all. For the same reason the listeners are attached on
 * mount rather than when a drag starts: an effect runs after the commit, and a
 * release that beat it would be the release that never arrived.
 */
export const useFloatDrag = ({
  display,
  float,
  onDrop,
  onGrab,
  onMove,
  onResize,
  resizes,
}: Options): FloatDrag => {
  const running = useRef<Drag | undefined>(undefined);
  const [drag, setDrag] = useState<{ resizes: boolean } | undefined>(undefined);

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const started = running.current;
      if (started !== undefined) {
        const [dx, dy] = offThePage(started.display, [
          event.clientX - started.from.x,
          event.clientY - started.from.y,
        ]);
        if (started.resizes) {
          started.onResize(started.box.width + dx, started.box.height + dy);
        } else {
          started.onMove(started.box.x + dx, started.box.y + dy);
        }
      }
    };
    // Idempotent, because both a release and a cancel can arrive for one drag —
    // a browser that ends a gesture itself sends the cancel after the release —
    // and dropping a window twice raises whatever ended up under it.
    const ended = () => {
      const started = running.current;
      if (started !== undefined) {
        running.current = undefined;
        setDrag(undefined);
        started.onDrop();
      }
    };
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", ended);
    window.addEventListener("pointercancel", ended);
    return () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", ended);
      window.removeEventListener("pointercancel", ended);
    };
  }, []);

  return {
    drag,
    onContextMenu: (event) => {
      event.preventDefault();
    },
    onPointerDown: (event) => {
      // Still captured, which costs nothing beside the listeners above and
      // covers the one thing they cannot see: a pointer that has moved over a
      // browsing context of its own, where the events are that document's.
      event.currentTarget.setPointerCapture(event.pointerId);
      const resizing = resizes || event.button === SECONDARY_BUTTON;
      running.current = {
        box: float,
        // Latched with the box and for the same reason: a desktop re-described
        // mid-drag would otherwise change what the moves since the press were
        // worth, and the window would jump.
        display,
        from: { x: event.clientX, y: event.clientY },
        onDrop,
        onMove,
        onResize,
        resizes: resizing,
      };
      setDrag({ resizes: resizing });
      onGrab();
    },
  };
};
