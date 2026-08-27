import type { PointerEvent } from "react";
import { useState } from "react";

import type { Float } from "./float";

type Drag = {
  /** The window's box when it was taken hold of, which the delta is from. */
  box: Float;
  from: { x: number; y: number };
  resizes: boolean;
};

type Handled = {
  onPointerCancel: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
};

export type FloatDrag = Handled & {
  /** Whether a drag is running, and whether it is resizing rather than moving. */
  drag: { resizes: boolean } | undefined;
};

type Options = {
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
 * drag: the sheet that catches an Alt+drag anywhere over it, and the title bar
 * that catches an ordinary one. What differs is where the pointer is allowed
 * to land, which is a matter of which element carries these.
 */
export const useFloatDrag = ({
  float,
  onDrop,
  onGrab,
  onMove,
  onResize,
  resizes,
}: Options): FloatDrag => {
  const [drag, setDrag] = useState<Drag | undefined>(undefined);

  const end = () => {
    if (drag !== undefined) {
      setDrag(undefined);
      onDrop();
    }
  };

  return {
    drag,
    onPointerCancel: end,
    onPointerDown: (event) => {
      // Captured, so the rest of the drag arrives here even when the pointer
      // leaves this element — which it does the moment the window falls behind
      // a faster one, and on every resize that shrinks it out from under the
      // cursor.
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        box: float,
        from: { x: event.clientX, y: event.clientY },
        resizes,
      });
      onGrab();
    },
    onPointerMove: (event) => {
      if (drag !== undefined) {
        const dx = event.clientX - drag.from.x;
        const dy = event.clientY - drag.from.y;
        if (drag.resizes) {
          onResize(drag.box.width + dx, drag.box.height + dy);
        } else {
          onMove(drag.box.x + dx, drag.box.y + dy);
        }
      }
    },
    onPointerUp: end,
  };
};
