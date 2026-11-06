import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";

import type { Direction } from "../direction";
import { Axis, axisOf } from "../direction";
import { followPress } from "../follow-press";

/** A border drag in progress, fixed when it started. */
type Drag = {
  edge: Direction;
  /** The pointer at the last move; the next delta is measured from it. */
  last: { x: number; y: number };
  onStretch: (edge: Direction, by: number) => void;
};

type Options = {
  /** The window side this border is on. */
  edge: Direction;
  onDrop: () => void;
  onGrab: () => void;
  /** The edge dragged `by` pixels, rightwards or downwards. */
  onStretch: (edge: Direction, by: number) => void;
};

/**
 * Moves a tiled window's edge by the pointer's travel along the edge's axis,
 * for as long as `followPress` follows the press.
 */
export const useBorderDrag = ({
  edge,
  onDrop,
  onGrab,
  onStretch,
}: Options): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} => {
  // Stops the running drag without dropping it, so a second press can take
  // over.
  const running = useRef<(() => void) | undefined>(undefined);

  return {
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      running.current?.();
      // The drag as of the last move, which the next is measured from.
      let drag: Drag = {
        edge,
        last: { x: event.clientX, y: event.clientY },
        onStretch,
      };
      running.current = followPress({
        element: event.currentTarget,
        onEnd: () => {
          running.current = undefined;
          onDrop();
        },
        onMove: ({ clientX, clientY }) => {
          drag = followed(drag, clientX, clientY);
        },
        pointerId: event.pointerId,
      });
      onGrab();
    },
  };
};

/** Moves the edge to follow the pointer at `x`, `y`. */
const followed = (drag: Drag, x: number, y: number): Drag => {
  const by =
    axisOf(drag.edge) === Axis.Horizontal ? x - drag.last.x : y - drag.last.y;
  if (by !== 0) {
    drag.onStretch(drag.edge, by);
  }
  return { ...drag, last: { x, y } };
};
