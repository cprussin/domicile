import { css, cx } from "../../../styled-system/css";
import type { Direction } from "../direction";
import { Axis, axisOf } from "../direction";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import { placedAt } from "../window-styles";
import { useBorderDrag } from "./useBorderDrag";

type Props = {
  /** Which side of the window it is. */
  edge: Direction;
  id: string;
  onDrop: () => void;
  onGrab: () => void;
  onStretch: (edge: Direction, by: number) => void;
  /** Where it is: the window's border and its half of the gap — see `borders.ts`. */
  rect: Rect;
};

/**
 * A strip along one side of a tiled window that resizes it when dragged, with
 * no modifier held: the edge of the window, or the gap between two.
 */
export const TileBorder = ({ edge, id, rect, ...handlers }: Props) => {
  const events = useBorderDrag({ edge, ...handlers });
  return (
    // Presentational, and `aria-hidden` for `FloatGrab`'s reason: resize mode
    // offers the same from the keyboard.
    <div
      aria-hidden
      className={cx(
        borderStyles,
        axisOf(edge) === Axis.Horizontal ? acrossStyles : upDownStyles,
      )}
      // Which window this border belongs to — see `FloatGrab`.
      data-window={id}
      style={placedAt(rect, TILED)}
      {...events}
    />
  );
};

const borderStyles = css({ position: "absolute" });

const acrossStyles = css({ cursor: "ew-resize" });

const upDownStyles = css({ cursor: "ns-resize" });
