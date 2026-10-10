import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";

import type { Rect } from "../rect";
import type { Corner } from "../tiled/aim";
import { cornerOf } from "../tiled/aim";
import type { Float } from "./float";
import { rectOf, stretched } from "./float";

/**
 * A drag in progress, fixed when it started.
 *
 * Holds the callbacks too, so the drag keeps working after its element
 * unmounts.
 */
type Drag = {
  /** The box when the drag started; the pointer delta applies to it. */
  box: Float;
  /** The corner being dragged, or `undefined` for a move. */
  corner: Corner | undefined;
  from: { x: number; y: number };
  onDrop: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (box: Rect) => void;
};

/** The secondary button, which resizes without a second modifier. */
const SECONDARY_BUTTON = 2;

export type FloatDrag = {
  /**
   * The running drag, if any, with the corner it resizes from (`undefined`
   * for a move).
   */
  drag: { corner: Corner | undefined } | undefined;
  /** Suppresses the context menu, since the right button resizes. */
  onContextMenu: (event: { preventDefault: () => void }) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Options = {
  /**
   * The window to drag, or `undefined` for a tiled window's title bar.
   *
   * The bar uses this hook too, so its element survives floating (see
   * `WindowTitleBar`). A press with `undefined` throws.
   */
  float: Float | undefined;
  onDrop: () => void;
  /** The window was taken hold of, to resize it or else to move it. */
  onGrab: (resizing: boolean) => void;
  onMove: (x: number, y: number) => void;
  /** The whole box, since dragging a top or left corner moves it too. */
  onResize: (box: Rect) => void;
  /**
   * Whether a drag started now resizes instead of moves.
   *
   * Read once at the start, so releasing Shift mid-resize does not turn it
   * into a move and make the window jump.
   */
  resizes: boolean;
};

/**
 * Moves or resizes a floating window by pointer drag, from either the Meta
 * sheet or the title bar.
 *
 * Only the press uses the element. Moves and the release are read from
 * `window`, because the pointer often leaves the element, and pointer capture
 * is lost when raising the window moves its element in the document. A drag
 * that never sees its release leaves the window stuck to the pointer.
 *
 * The listeners belong to the drag, not the component: a window dragged onto
 * another screen unmounts the pressed element (see `floatDragged`). They are
 * added in the press handler, not an effect, so a fast click's release is not
 * missed before the effect runs.
 */
export const useFloatDrag = ({
  float,
  onDrop,
  onGrab,
  onMove,
  onResize,
  resizes,
}: Options): FloatDrag => {
  // Stops the running drag without dropping it, so a second press (another
  // button) can take over.
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
        // Capture as well, for a pointer over another browsing context, whose
        // events `window` does not see.
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
        onGrab(corner !== undefined);
      }
    },
  };
};

/**
 * Applies pointer moves to `drag` until a release or cancel drops it and calls
 * `ended`. Returns a function that stops listening without dropping.
 *
 * Only the first of release and cancel drops, since a browser can send both
 * and a second drop would raise whatever is underneath.
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
