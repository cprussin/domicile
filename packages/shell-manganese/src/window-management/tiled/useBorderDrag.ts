import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";

import type { Direction } from "../direction";
import { Axis, axisOf } from "../direction";

/** A drag of one border in progress, settled when it was taken hold of. */
type Drag = {
  edge: Direction;
  /** Where the pointer was at the last move, which the next is measured from. */
  last: { x: number; y: number };
  onDrop: () => void;
  onStretch: (edge: Direction, by: number) => void;
};

type Options = {
  /** Which side of the window this border is. */
  edge: Direction;
  onDrop: () => void;
  onGrab: () => void;
  /** The edge dragged `by` pixels, rightwards or downwards. */
  onStretch: (edge: Direction, by: number) => void;
};

/**
 * Turning a drag on a tiled window's border into that edge moved: the pointer's
 * travel along the edge's axis, move by move, and nothing across it.
 *
 * The press is the element's and the rest of the drag is the window's, and the
 * drag is a ref rather than state — both for the reasons `useFloatDrag` gives.
 */
export const useBorderDrag = ({
  edge,
  onDrop,
  onGrab,
  onStretch,
}: Options): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} => {
  const running = useRef<Drag | undefined>(undefined);

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const started = running.current;
      if (started !== undefined) {
        running.current = followed(started, event.clientX, event.clientY);
      }
    };
    // Idempotent, because both a release and a cancel can arrive for one
    // drag — see `useFloatDrag`.
    const ended = () => {
      const started = running.current;
      if (started !== undefined) {
        running.current = undefined;
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
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      running.current = {
        edge,
        last: { x: event.clientX, y: event.clientY },
        onDrop,
        onStretch,
      };
      onGrab();
    },
  };
};

/** The drag with the pointer at `x`, `y`, and the edge moved to follow it. */
const followed = (drag: Drag, x: number, y: number): Drag => {
  const by =
    axisOf(drag.edge) === Axis.Horizontal ? x - drag.last.x : y - drag.last.y;
  if (by !== 0) {
    drag.onStretch(drag.edge, by);
  }
  return { ...drag, last: { x, y } };
};
