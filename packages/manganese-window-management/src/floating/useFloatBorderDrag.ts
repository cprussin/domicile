import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";

import { followPress } from "../follow-press";
import type { Rect } from "../rect";
import type { Float, Grip } from "./float";
import { rectOf, stretched } from "./float";

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
 * Resizes a floating window by dragging one of its borders, for as long as
 * `followPress` follows the press.
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
      // Where the press started. The pointer's travel from it applies to
      // `float`, the box as pressed.
      const from = { x: event.clientX, y: event.clientY };
      running.current = followPress({
        element: event.currentTarget,
        onEnd: () => {
          running.current = undefined;
          onDrop();
        },
        onMove: ({ clientX, clientY }) => {
          onResize(
            rectOf(stretched(float, grip, clientX - from.x, clientY - from.y)),
          );
        },
        pointerId: event.pointerId,
      });
      onGrab();
    },
  };
};
