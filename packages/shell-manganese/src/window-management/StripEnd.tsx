import { css, cx } from "../../styled-system/css";
import type { Float } from "./floating/float";
import { useFloatDrag } from "./floating/useFloatDrag";
import { grabCursorStyles } from "./grab-cursor-styles";
import type { Rect } from "./rect";
import type { Aim, DropTargets } from "./tiled/aim";
import { useTileDrag } from "./tiled/useTileDrag";
import type { StripGroup } from "./tree/frames";
import { GrabCursor } from "./useGrabCursor";
import { placedAt } from "./window-styles";

/** The primary button, as `PointerEvent.button` numbers it. */
const PRIMARY_BUTTON = 0;

type Props = {
  /** The stacking depth of the strip's last tab, which draws the end. */
  depth: number;
  /** The float holding the group, or `undefined` while it is tiled. */
  float: Float | undefined;
  group: StripGroup;
  /** Where the dragged group would land if dropped now. */
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  /** A tiled group dropped where it was aimed. See `useTileDrag`. */
  onDropOn: (aim: Aim) => void;
  onGrab: () => void;
  /** A float's new top-left corner. */
  onMove: (x: number, y: number) => void;
  /** The empty end. See `stripEndOf`. */
  rect: Rect;
  /** What a tiled group can be dropped on, on every screen. */
  targets: DropTargets;
};

/**
 * The empty end of a tabbed strip, which drags the strip's whole group with
 * the primary button: a tiled group like a tiled window's bar, a float like
 * its bar.
 *
 * Drawn under the strip's last tab, whose end is click-through, so the
 * new-tab button over it stays on top.
 */
export const StripEnd = ({
  depth,
  float,
  group,
  onAim,
  onDrop,
  onDropOn,
  onGrab,
  onMove,
  rect,
  targets,
}: Props) => {
  // Both hooks run for every end, since hooks cannot be conditional.
  const floatDrag = useFloatDrag({
    float,
    onDrop,
    onGrab,
    onMove,
    onResize: doesNotResize,
    resizes: false,
  });
  const tileDrag = useTileDrag({
    dragged: group.windows,
    frame: rect,
    onAim,
    onDrop,
    onDropOn,
    onGrab,
    onStretch: doesNotResize,
    resizes: false,
    targets,
  });
  const drag = float === undefined ? tileDrag : floatDrag;
  return (
    // `aria-hidden`: the keyboard offers everything this does.
    <div
      aria-hidden
      className={cx(
        endStyles,
        // It holds pointer capture during a drag, so its cursor shows.
        drag.drag !== undefined && grabCursorStyles[GrabCursor.Grabbing],
      )}
      // Tells it from a window's grab sheet, for tests.
      data-group-handle
      // A press here lands outside every `<app>`, so the window is named for
      // the focus handling in `AppWindow`.
      data-window={group.node.id}
      onPointerDown={(event) => {
        if (event.button === PRIMARY_BUTTON) {
          drag.onPointerDown(event);
        }
      }}
      style={placedAt(rect, depth)}
    />
  );
};

const endStyles = css({ position: "absolute" });

/** Never called: the end only moves its group. */
const doesNotResize = () => {
  throw new Error("strip end: the end does not resize its group");
};
