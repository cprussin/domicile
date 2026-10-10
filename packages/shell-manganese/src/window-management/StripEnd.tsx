import { Button } from "@domicile-desktop/component-library/Button";
import { BrowsersIcon } from "@phosphor-icons/react/dist/ssr/Browsers";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";

import { css, cx } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
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
  /**
   * Whether the group fills the screen, which switches its button to
   * "Restore" and keeps the group from being dragged.
   */
  fullscreen: boolean;
  group: StripGroup;
  /** Where the dragged group would land if dropped now. */
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  /** A tiled group dropped where it was aimed. See `useTileDrag`. */
  onDropOn: (aim: Aim) => void;
  /** Floats or tiles the whole group. */
  onFloat: () => void;
  /** Fills the screen with the whole group, or gives it back. */
  onFullscreen: () => void;
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
 * its bar. A fullscreen group does not drag, as a fullscreen window does not.
 * Buttons at its end float and fullscreen the group.
 *
 * Drawn under the strip's last tab, whose end is click-through, so the
 * new-tab button over it stays on top.
 */
export const StripEnd = ({
  depth,
  float,
  fullscreen,
  group,
  onAim,
  onDrop,
  onDropOn,
  onFloat,
  onFullscreen,
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
    <div
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
        if (event.button === PRIMARY_BUTTON && !fullscreen) {
          drag.onPointerDown(event);
        }
      }}
      style={placedAt(rect, depth)}
    >
      {/*
        A press on a button must not start a drag: drag pointer capture would
        retarget the click to the end.
      */}
      <span
        className={controlStyles}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <Button
          label={float === undefined ? "Float group" : "Tile group"}
          onClick={onFloat}
          size="xs"
          variant="ghost"
        >
          {float === undefined ? (
            <BrowsersIcon size={12} />
          ) : (
            <SquaresFourIcon size={12} />
          )}
        </Button>
        <Button
          label={fullscreen ? "Restore group" : "Maximize group"}
          onClick={onFullscreen}
          size="xs"
          variant="ghost"
        >
          {fullscreen ? (
            <CornersInIcon size={12} />
          ) : (
            <CornersOutIcon size={12} />
          )}
        </Button>
      </span>
    </div>
  );
};

const endStyles = css({ position: "absolute" });

/**
 * The group's buttons, at the strip's far end, level with the new-tab button
 * at its start (see `newTabStyles` in `TitleBar`).
 */
const controlStyles = hstack({
  gap: 0,
  insetBlockEnd: "1px",
  insetBlockStart: 1,
  insetInlineEnd: 1,
  position: "absolute",
});

/** Never called: the end only moves its group. */
const doesNotResize = () => {
  throw new Error("strip end: the end does not resize its group");
};
