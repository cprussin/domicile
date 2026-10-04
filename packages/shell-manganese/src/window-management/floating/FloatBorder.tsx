import { css, cx } from "../../../styled-system/css";
import { grabCursorStyles } from "../grab-cursor-styles";
import type { Rect } from "../rect";
import type { GrabCursor } from "../useGrabCursor";
import { placedAt } from "../window-styles";
import type { Float, Grip } from "./float";
import { useFloatBorderDrag } from "./useFloatBorderDrag";

type Props = {
  cursor: GrabCursor;
  /** The stacking depth of the window it resizes. */
  depth: number;
  float: Float;
  grip: Grip;
  onDrop: () => void;
  onGrab: () => void;
  onResize: (box: Rect) => void;
  /** Its box. See `float-borders.ts`. */
  rect: Rect;
  /** The window it resizes. See `FloatGrab`. */
  window: string;
};

/**
 * An edge or corner of a floating window that resizes it when dragged, without
 * a modifier. The floating counterpart of `TileBorder`.
 */
export const FloatBorder = ({
  cursor,
  depth,
  float,
  grip,
  rect,
  window,
  ...handlers
}: Props) => {
  const events = useFloatBorderDrag({ float, grip, ...handlers });
  return (
    // Hidden from assistive tech: resize mode offers the same from the
    // keyboard.
    <div
      aria-hidden
      className={cx(borderStyles, grabCursorStyles[cursor])}
      // Distinguishes a border from a `FloatGrab`.
      data-border
      // See `FloatGrab`.
      data-window={window}
      style={placedAt(rect, depth)}
      {...events}
    />
  );
};

const borderStyles = css({ position: "absolute" });
