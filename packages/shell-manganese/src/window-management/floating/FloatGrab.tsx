import { css, cx } from "../../../styled-system/css";
import { grabCursorStyles } from "../grab-cursor-styles";
import type { Rect } from "../rect";
import { useGrabCursor } from "../useGrabCursor";
import { placedAt } from "../window-styles";
import type { Float } from "./float";
import { rectOf } from "./float";
import { useFloatDrag } from "./useFloatDrag";

type Props = {
  /** The stacking depth of the window it covers. */
  depth: number;
  float: Float;
  onDrop: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (box: Rect) => void;
  /** Whether a drag resizes the window instead of moving it. */
  resizes: boolean;
  /**
   * The float's focused window, which is its only window unless it holds a
   * group.
   */
  window: string;
};

/**
 * An overlay that catches pointer drags on a floating window while the
 * modifier is held.
 *
 * The pointer over an `<app>` goes to its client, so the shell makes the
 * window click-through (see `clickThroughStyles`) and catches the pointer
 * here instead. Mounted only while the modifier is held or a drag runs.
 * Covers the whole frame, so a drag behaves the same on the title bar.
 */
export const FloatGrab = ({
  depth,
  float,
  resizes,
  window,
  ...moves
}: Props) => {
  const { drag, ...handlers } = useFloatDrag({
    float,
    resizes,
    ...moves,
  });
  const { cursor, onPointerMove } = useGrabCursor({
    drag,
    frame: rectOf(float),
    resizes,
  });
  return (
    // Hidden from assistive tech: everything here is also available from the
    // keyboard.
    <div
      aria-hidden
      className={cx(grabStyles, grabCursorStyles[cursor])}
      // Read by `AppWindow`, not for styling: a press here lands outside every
      // `<app>`, so the window is named for the focus handling in
      // `AppWindow`.
      data-window={window}
      onPointerMove={onPointerMove}
      style={placedAt(rectOf(float), depth)}
      {...handlers}
    />
  );
};

const grabStyles = css({ position: "absolute" });
