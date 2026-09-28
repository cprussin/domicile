import { css, cx } from "../../../styled-system/css";
import type { Direction } from "../direction";
import { grabCursorStyles } from "../grab-cursor-styles";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import { useGrabCursor } from "../useGrabCursor";
import { placedAt } from "../window-styles";
import type { Aim, Target } from "./aim";
import { useTileDrag } from "./useTileDrag";

type Props = {
  /** The whole box of the tiled window it covers. */
  frame: Rect;
  id: string;
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (target: string, edge: Direction | undefined) => void;
  onGrab: () => void;
  onStretch: (edge: Direction, by: number) => void;
  /** Whether taking hold now would resize the window rather than move it. */
  resizes: boolean;
  /** The tiled windows on this screen, which it can be dropped on. */
  targets: readonly Target[];
};

/**
 * The sheet the pointer lands on while the desktop's modifier is held, over
 * one tiled window — `FloatGrab`'s counterpart, for the same reason: the
 * pointer over a window belongs to the client behind it, so the shell makes
 * the window click-through and catches what falls through here.
 *
 * Mounted only while the modifier is held or a drag is running.
 */
export const TileGrab = ({ frame, id, resizes, ...handlers }: Props) => {
  const { drag, ...events } = useTileDrag({ frame, id, resizes, ...handlers });
  const { cursor, onPointerMove } = useGrabCursor({ drag, frame, resizes });
  return (
    // Presentational, and `aria-hidden` for `FloatGrab`'s reason: everything
    // this offers the keyboard offers as well.
    <div
      aria-hidden
      className={cx(grabStyles, grabCursorStyles[cursor])}
      // Which window this sheet belongs to — see `FloatGrab`.
      data-window={id}
      onPointerMove={onPointerMove}
      style={placedAt(frame, TILED)}
      {...events}
    />
  );
};

const grabStyles = css({ position: "absolute" });
