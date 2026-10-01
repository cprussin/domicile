import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";

import type { Rect } from "../rect";
import type { Corner } from "../tiled/aim";
import { cornerOf } from "../tiled/aim";
import type { Float } from "./float";
import { rectOf, stretched } from "./float";

/**
 * A drag in progress: everything about it that was settled when the window was
 * taken hold of.
 *
 * The callbacks are latched here with the box for one reason rather than two:
 * they are what this drag does, and a drag is what it was when it started.
 * Keeping them here is also what lets a drag go on with nothing rendered at
 * all — its element gone with the window to another monitor's `Stage` — so no part of
 * it depends on a render having happened.
 */
type Drag = {
  /** The window's box when it was taken hold of, which the delta is from. */
  box: Float;
  /** The corner being dragged, or `undefined` for a move. */
  corner: Corner | undefined;
  from: { x: number; y: number };
  onDrop: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (box: Rect) => void;
};

/**
 * The secondary button, which resizes whatever it takes hold of.
 *
 * The other way to a resize, and the one that needs no second modifier held:
 * whatever handed the pointer to the shell, the right button means a corner
 * rather than the whole window.
 */
const SECONDARY_BUTTON = 2;

export type FloatDrag = {
  /**
   * Whether a drag is running, and the corner it is resizing from, or
   * `undefined` for a move.
   */
  drag: { corner: Corner | undefined } | undefined;
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
   * The window taken hold of, or `undefined` for a tiled window's bar: that
   * bar calls this too, so its element is the same one before and after the
   * window floats — see `WindowTitleBar` — and it must never be pressed into
   * a drag.
   */
  float: Float | undefined;
  onDrop: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  /** The whole box, since a corner at the top or the left moves it too. */
  onResize: (box: Rect) => void;
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
 * **AND THE ELEMENT MAY GO WHILE THE HAND HOLDS ON.** A window dragged onto
 * the next monitor is drawn by that monitor's `Stage` from then on, and the
 * element pressed on this one is taken out of the document — but the drag goes
 * on, in the page's pixels (see `floatDragged`). So the listeners belong to
 * the drag rather than to the
 * component: added by the press, in the handler itself, and taken off by the
 * release. In the handler rather than an effect for a second reason: an
 * effect runs after the commit, and a release that beat it — a click — would
 * be the release that never arrived.
 *
 * The state beside it is only what to draw, and a `Stage` that has stopped
 * drawing the element has nothing to draw it on.
 */
export const useFloatDrag = ({
  float,
  onDrop,
  onGrab,
  onMove,
  onResize,
  resizes,
}: Options): FloatDrag => {
  // How to stop following the drag that is running, without dropping it: a
  // second press while one is — another button — takes over from the first.
  const running = useRef<(() => void) | undefined>(undefined);
  const [drag, setDrag] = useState<{ corner: Corner | undefined } | undefined>(
    undefined,
  );

  return {
    drag,
    onContextMenu: (event) => {
      event.preventDefault();
    },
    onPointerDown: (event) => {
      if (float === undefined) {
        throw new Error("float drag: no floating window to take hold of");
      } else {
        // Still captured, which costs nothing beside the listeners above and
        // covers the one thing they cannot see: a pointer that has moved over a
        // browsing context of its own, where the events are that document's.
        event.currentTarget.setPointerCapture(event.pointerId);
        const corner =
          resizes || event.button === SECONDARY_BUTTON
            ? cornerOf(rectOf(float), event.clientX, event.clientY)
            : undefined;
        running.current?.();
        running.current = follow(
          {
            box: float,
            corner,
            from: { x: event.clientX, y: event.clientY },
            onDrop,
            onMove,
            onResize,
          },
          () => {
            running.current = undefined;
            setDrag(undefined);
          },
        );
        setDrag({ corner });
        onGrab();
      }
    },
  };
};

/**
 * Follow `drag` until the pointer lets go: every move of it moves or resizes
 * the window, and the release or a cancel drops it and stops listening, then
 * says so with `ended`. Returns how to stop listening without dropping.
 *
 * Only the first of a release and a cancel drops it — a browser that ends a
 * gesture itself sends the cancel after the release, and dropping a window
 * twice raises whatever ended up under it — because the first takes both
 * listeners off.
 */
const follow = (drag: Drag, ended: () => void): (() => void) => {
  const moved = (event: PointerEvent) => {
    const dx = event.clientX - drag.from.x;
    const dy = event.clientY - drag.from.y;
    if (drag.corner === undefined) {
      drag.onMove(drag.box.x + dx, drag.box.y + dy);
    } else {
      drag.onResize(rectOf(stretched(drag.box, drag.corner, dx, dy)));
    }
  };
  const stop = () => {
    window.removeEventListener("pointermove", moved);
    window.removeEventListener("pointerup", released);
    window.removeEventListener("pointercancel", released);
  };
  const released = () => {
    stop();
    ended();
    drag.onDrop();
  };
  window.addEventListener("pointermove", moved);
  window.addEventListener("pointerup", released);
  window.addEventListener("pointercancel", released);
  return stop;
};
