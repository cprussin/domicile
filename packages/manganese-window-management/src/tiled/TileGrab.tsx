import { css, cx } from "../../styled-system/css";
import type { Direction } from "../direction";
import { grabCursorStyles } from "../grab-cursor-styles";
import type { Press } from "../handed-drag";
import { TILED } from "../placement";
import type { Spot } from "../pointer-warp";
import type { Rect } from "../rect";
import { useGrabCursor } from "../useGrabCursor";
import { useHandedPress } from "../useHandedPress";
import { placedAt } from "../window-styles";
import type { Aim, DropTargets } from "./aim";
import { useTileDrag } from "./useTileDrag";

type Props = {
  /**
   * A press a client handed over, to start the drag from as though it had
   * landed here. See `HandedDrag`.
   */
  handed?: Press | undefined;
  /** The box of the tiled window it covers. */
  frame: Rect;
  id: string;
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  onDropOn: (aim: Aim) => void;
  onGrab: (resizing: boolean) => void;
  /** The pointer entered the sheet, at this page position. See `WindowFrame`. */
  onHover: (at: Spot) => void;
  onPull: () => void;
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
export const TileGrab = ({
  frame,
  handed,
  id,
  onHover,
  resizes,
  ...handlers
}: Props) => {
  const { drag, ...events } = useTileDrag({
    dragged: { node: { id, up: 0 }, windows: [id] },
    frame,
    resizes,
    ...handlers,
  });
  const { cursor, onPointerMove } = useGrabCursor({ drag, frame, resizes });
  const sheet = useHandedPress(handed, events.onPointerDown);
  return (
    // `aria-hidden`: the keyboard offers everything this does.
    <div
      aria-hidden
      className={cx(grabStyles, grabCursorStyles[cursor])}
      // The window this sheet belongs to. See `FloatGrab`.
      data-window={id}
      onPointerMove={onPointerMove}
      // The sheet covers the window, so focus follows the pointer from here.
      onPointerOver={(event) => {
        onHover([event.clientX, event.clientY]);
      }}
      ref={sheet}
      style={placedAt(frame, TILED)}
      {...events}
    />
  );
};

const grabStyles = css({ position: "absolute" });
