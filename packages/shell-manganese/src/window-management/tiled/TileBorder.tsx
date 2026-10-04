import { css, cx } from "../../../styled-system/css";
import type { Direction } from "../direction";
import { Axis, axisOf } from "../direction";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import { placedAt } from "../window-styles";
import { useBorderDrag } from "./useBorderDrag";

type Props = {
  /** The window side this border is on. */
  edge: Direction;
  id: string;
  onDrop: () => void;
  onGrab: () => void;
  onStretch: (edge: Direction, by: number) => void;
  /** The window's border plus its half of the gap. See `borders.ts`. */
  rect: Rect;
};

/** A strip along a tiled window's edge that resizes it without a modifier. */
export const TileBorder = ({ edge, id, rect, ...handlers }: Props) => {
  const events = useBorderDrag({ edge, ...handlers });
  return (
    // `aria-hidden`: resize mode offers the same from the keyboard.
    <div
      aria-hidden
      className={cx(
        borderStyles,
        axisOf(edge) === Axis.Horizontal ? acrossStyles : upDownStyles,
      )}
      // The window this border belongs to. See `FloatGrab`.
      data-window={id}
      style={placedAt(rect, TILED)}
      {...events}
    />
  );
};

const borderStyles = css({ position: "absolute" });

const acrossStyles = css({ cursor: "ew-resize" });

const upDownStyles = css({ cursor: "ns-resize" });
