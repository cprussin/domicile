import { css, cx } from "../../../styled-system/css";
import { grabCursorStyles } from "../grab-cursor-styles";
import type { Rect } from "../rect";
import type { GrabCursor } from "../useGrabCursor";
import { placedAt } from "../window-styles";
import type { Float, Grip } from "./float";
import { useFloatBorderDrag } from "./useFloatBorderDrag";

type Props = {
  cursor: GrabCursor;
  /** How it stacks, which is the depth of the window it resizes. */
  depth: number;
  float: Float;
  grip: Grip;
  onDrop: () => void;
  onGrab: () => void;
  onResize: (box: Rect) => void;
  /** Where it is — see `float-borders.ts`. */
  rect: Rect;
};

/**
 * One edge or corner of a floating window that resizes it when dragged, with
 * no modifier held — `TileBorder`'s counterpart.
 */
export const FloatBorder = ({
  cursor,
  depth,
  float,
  grip,
  rect,
  ...handlers
}: Props) => {
  const events = useFloatBorderDrag({ float, grip, ...handlers });
  return (
    // Presentational, and `aria-hidden` for `FloatGrab`'s reason: resize mode
    // offers the same from the keyboard.
    <div
      aria-hidden
      className={cx(borderStyles, grabCursorStyles[cursor])}
      // Which is a border rather than the sheet a held modifier puts up.
      data-border
      // Which window this border belongs to — see `FloatGrab`.
      data-window={float.id}
      style={placedAt(rect, depth)}
      {...events}
    />
  );
};

const borderStyles = css({ position: "absolute" });
