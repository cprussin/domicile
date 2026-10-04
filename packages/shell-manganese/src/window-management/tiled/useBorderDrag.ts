import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";

import type { Direction } from "../direction";
import { Axis, axisOf } from "../direction";

/** A border drag in progress, fixed when it started. */
type Drag = {
  edge: Direction;
  /** The pointer at the last move; the next delta is measured from it. */
  last: { x: number; y: number };
  onDrop: () => void;
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
 * Moves a tiled window's edge by the pointer's travel along the edge's axis.
 *
 * Listens for the rest of the drag on `window`, as `useFloatDrag` explains.
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
    // Idempotent: one drag can get both a release and a cancel.
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

/** Moves the edge to follow the pointer at `x`, `y`. */
const followed = (drag: Drag, x: number, y: number): Drag => {
  const by =
    axisOf(drag.edge) === Axis.Horizontal ? x - drag.last.x : y - drag.last.y;
  if (by !== 0) {
    drag.onStretch(drag.edge, by);
  }
  return { ...drag, last: { x, y } };
};
