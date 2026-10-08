import { css, cx } from "../../../styled-system/css";
import type { Direction } from "../direction";
import { grabCursorStyles } from "../grab-cursor-styles";
import { TILED } from "../placement";
import type { Rect } from "../rect";
import { useGrabCursor } from "../useGrabCursor";
import { placedAt } from "../window-styles";
import type { Aim, DropTargets } from "./aim";
import { useTileDrag } from "./useTileDrag";

type Props = {
  /** The box of the tiled window it covers. */
  frame: Rect;
  id: string;
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (aim: Aim) => void;
  onGrab: (resizing: boolean) => void;
  onStretch: (edge: Direction, by: number) => void;
  /** Whether a drag started now resizes instead of moves. */
  resizes: boolean;
  /** What it can be dropped on, on every screen. */
  targets: DropTargets;
};

/**
 * A transparent sheet over a tiled window that catches Meta+drag, like
 * `FloatGrab`. The window itself is click-through meanwhile, since its pointer
 * events would go to the client.
 *
 * Mounted only while the modifier is held or a drag is running.
 */
export const TileGrab = ({ frame, id, resizes, ...handlers }: Props) => {
  const { drag, ...events } = useTileDrag({ frame, id, resizes, ...handlers });
  const { cursor, onPointerMove } = useGrabCursor({ drag, frame, resizes });
  return (
    // `aria-hidden`: the keyboard offers everything this does.
    <div
      aria-hidden
      className={cx(grabStyles, grabCursorStyles[cursor])}
      // The window this sheet belongs to. See `FloatGrab`.
      data-window={id}
      onPointerMove={onPointerMove}
      style={placedAt(frame, TILED)}
      {...events}
    />
  );
};

const grabStyles = css({ position: "absolute" });
