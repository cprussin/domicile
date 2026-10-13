import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";

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
 * Listens for the rest of the drag on `window`, as `useFloatDrag` explains,
 * and only while it runs, since every tiled border has this hook.
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
      running.current = follow(
        {
          edge,
          last: { x: event.clientX, y: event.clientY },
          onDrop,
          onStretch,
        },
        () => {
          running.current = undefined;
        },
      );
      onGrab();
    },
  };
};

/**
 * Applies pointer moves to `drag` until a release or cancel drops it and calls
 * `ended`. Returns a function that stops listening without dropping.
 *
 * Only the first of release and cancel drops, since a browser can send both.
 */
const follow = (started: Drag, ended: () => void): (() => void) => {
  // The drag as of the last move, which the next is measured from.
  let drag = started;
  const moved = (event: PointerEvent) => {
    drag = followed(drag, event.clientX, event.clientY);
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

/** Moves the edge to follow the pointer at `x`, `y`. */
const followed = (drag: Drag, x: number, y: number): Drag => {
  const by =
    axisOf(drag.edge) === Axis.Horizontal ? x - drag.last.x : y - drag.last.y;
  if (by !== 0) {
    drag.onStretch(drag.edge, by);
  }
  return { ...drag, last: { x, y } };
};
