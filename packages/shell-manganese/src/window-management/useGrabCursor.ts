// The cursor over a window the desktop's modifier has taken hold of: the
// diagonal of the corner a resize drives, or a move.

import { useState } from "react";

import { isForward } from "./direction";
import type { Rect } from "./rect";
import type { Corner } from "./tiled/aim";
import { cornerOf } from "./tiled/aim";

export enum GrabCursor {
  Move,
  /** The top-right or bottom-left corner. */
  ResizeNesw,
  /** The top-left or bottom-right corner. */
  ResizeNwse,
}

type Options = {
  /** The drag running, if any, and the corner it resizes from. */
  drag: { corner: Corner | undefined } | undefined;
  /** The window's whole box, whose quarters say which corner a resize drives. */
  frame: Rect;
  /** Whether taking hold now would resize the window rather than move it. */
  resizes: boolean;
};

/**
 * Which cursor a grab sheet shows: before a drag, the corner of the quarter
 * the pointer is over; during one, the corner it took hold of — the window
 * moves under the pointer as it resizes, so where the pointer is by then says
 * nothing about which corner is being dragged.
 *
 * The hovered cursor is kept rather than the corner, so a pointer that moves
 * within one quarter renders nothing.
 */
export const useGrabCursor = ({
  drag,
  frame,
  resizes,
}: Options): {
  cursor: GrabCursor;
  onPointerMove: (event: { clientX: number; clientY: number }) => void;
} => {
  // Bottom-right until the pointer has moved: a sheet mounted under a still
  // pointer has not been told where it is.
  const [hovered, setHovered] = useState(GrabCursor.ResizeNwse);
  return {
    cursor: cursorFor(drag, resizes, hovered),
    onPointerMove: (event) => {
      setHovered(diagonalOf(cornerOf(frame, event.clientX, event.clientY)));
    },
  };
};

const cursorFor = (
  drag: Options["drag"],
  resizes: boolean,
  hovered: GrabCursor,
): GrabCursor => {
  if (drag === undefined) {
    return resizes ? hovered : GrabCursor.Move;
  } else {
    return drag.corner === undefined
      ? GrabCursor.Move
      : diagonalOf(drag.corner);
  }
};

/** Top-left and bottom-right share a diagonal, as do the other two. */
const diagonalOf = ({ horizontal, vertical }: Corner): GrabCursor =>
  isForward(horizontal) === isForward(vertical)
    ? GrabCursor.ResizeNwse
    : GrabCursor.ResizeNesw;
