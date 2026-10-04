import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef } from "react";

import type { Rect } from "../rect";
import type { Float, Grip } from "./float";
import { rectOf, stretched } from "./float";

/** A border drag in progress, fixed when it started. */
type Drag = {
  /** The box when the drag started; the pointer delta applies to it. */
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
  /** The whole box, since dragging the top or left edge moves it too. */
  onResize: (box: Rect) => void;
};

/**
 * Resizes a floating window by dragging one of its borders.
 *
 * Listens for the rest of the drag on `window`, as `useFloatDrag` explains.
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
