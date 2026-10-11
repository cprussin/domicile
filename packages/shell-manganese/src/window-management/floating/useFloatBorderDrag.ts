import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";

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
 * Listens for the rest of the drag on `window`, as `useFloatDrag` explains,
 * and only while it runs, since every float border has this hook.
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
  // Stops the running drag without dropping it, so a second press can take
  // over.
  const running = useRef<(() => void) | undefined>(undefined);

  return {
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      running.current?.();
      running.current = follow(
        {
          box: float,
          from: { x: event.clientX, y: event.clientY },
          grip,
          onDrop,
          onResize,
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
const follow = (drag: Drag, ended: () => void): (() => void) => {
  const moved = (event: PointerEvent) => {
    drag.onResize(
      rectOf(
        stretched(
          drag.box,
          drag.grip,
          event.clientX - drag.from.x,
          event.clientY - drag.from.y,
        ),
      ),
    );
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
