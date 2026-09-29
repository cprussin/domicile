import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";

import type { Rect } from "../rect";
import type { Float, Grip } from "./float";
import { rectOf, stretched } from "./float";

/** A drag of one border in progress, settled when it was taken hold of. */
type Drag = {
  /** The window's box when it was taken hold of, which the delta is from. */
  box: Float;
  from: { x: number; y: number };
  grip: Grip;
  onDrop: () => void;
  onResize: (box: Rect) => void;
};

type Options = {
  float: Float;
  /** The edges this border drags. */
  grip: Grip;
  onDrop: () => void;
  onGrab: () => void;
  /** The whole box, since an edge at the top or the left moves it too. */
  onResize: (box: Rect) => void;
};

/**
 * Turning a drag on a floating window's border into that window resized: the
 * edges the border holds follow the pointer, and the rest stay put.
 *
 * The press is the element's and the rest of the drag is the window's, and the
 * drag is a ref rather than state — both for the reasons `useFloatDrag` gives.
 */
export const useFloatBorderDrag = ({
  float,
  grip,
  onDrop,
  onGrab,
  onResize,
}: Options): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} => {
  const running = useRef<Drag | undefined>(undefined);

  useEffect(() => {
    const moved = (event: PointerEvent) => {
      const started = running.current;
      if (started !== undefined) {
        started.onResize(
          rectOf(
            stretched(
              started.box,
              started.grip,
              event.clientX - started.from.x,
              event.clientY - started.from.y,
            ),
          ),
        );
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
        box: float,
        from: { x: event.clientX, y: event.clientY },
        grip,
        onDrop,
        onResize,
      };
      onGrab();
    },
  };
};
