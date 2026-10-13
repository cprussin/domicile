// Cursors for modifier grabs (a move, or a resize from a corner) and for
// floating window borders (see `floating/float-borders.ts`).

import { useState } from "react";

import { isForward } from "./direction";
import type { Rect } from "./rect";
import type { Corner } from "./tiled/aim";
import { cornerOf } from "./tiled/aim";

export enum GrabCursor {
  /** A move under way. */
  Grabbing,
  Move,
  /** The left or right edge. */
  ResizeEw,
  /** The top-right or bottom-left corner. */
  ResizeNesw,
  /** The top or bottom edge. */
  ResizeNs,
  /** The top-left or bottom-right corner. */
  ResizeNwse,
}

type Options = {
  /** The active drag, if any, and the corner it resizes from. */
  drag: { corner: Corner | undefined } | undefined;
  /** The window's frame; the quadrant under the pointer picks the corner. */
  frame: Rect;
  /** Whether a grab now would resize rather than move. */
  resizes: boolean;
};

/**
 * The cursor a grab sheet shows.
 *
 * Before a drag it follows the hovered quadrant. During a drag it stays on the
 * grabbed corner, since the window moves under the pointer. State holds the
 * cursor, not the corner, so moves within one quadrant do not re-render.
 */
export const useGrabCursor = ({
  drag,
  frame,
  resizes,
}: Options): {
  cursor: GrabCursor;
  onPointerMove: (event: { clientX: number; clientY: number }) => void;
} => {
  // Bottom-right by default: a sheet mounted under a still pointer has no
  // position yet.
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
      ? GrabCursor.Grabbing
      : diagonalOf(drag.corner);
  }
};

/** Top-left and bottom-right share a diagonal, as do the other two. */
const diagonalOf = ({ horizontal, vertical }: Corner): GrabCursor =>
  isForward(horizontal) === isForward(vertical)
    ? GrabCursor.ResizeNwse
    : GrabCursor.ResizeNesw;
