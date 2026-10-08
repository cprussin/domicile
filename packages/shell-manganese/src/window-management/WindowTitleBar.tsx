import type { PointerEvent as ReactPointerEvent } from "react";

import type { Float } from "./floating/float";
import type { FloatDrag } from "./floating/useFloatDrag";
import { useFloatDrag } from "./floating/useFloatDrag";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { TitleBar } from "./TitleBar";
import type { Aim, DropTargets } from "./tiled/aim";
import type { TileDrag } from "./tiled/useTileDrag";
import { useTileDrag } from "./tiled/useTileDrag";
import type { TitleFocus } from "./title-focus";
import type { TabLayout } from "./tree/frames";
import type { WindowMotion } from "./window-motion";

/** The primary button, as `PointerEvent.button` numbers it. */
const PRIMARY_BUTTON = 0;

type Props = {
  /** Whether this is a hidden tab. See {@link TitleBar}. */
  besideOpenTab: boolean;
  /** The stacking depth of the window it names. */
  depth: number;
  /** Whether this window is being dragged. See {@link TitleBar}. */
  dragging: boolean;
  /** The window's float, or `undefined` while it is tiled. */
  float: Float | undefined;
  /** The bar's focus state. See `title-focus.ts`. */
  focus: TitleFocus;
  /** Whether its tab group is selected. See {@link TitleBar}. */
  groupSelected: boolean;
  /** The window's whole box. See {@link TitleBar}. */
  frame: Rect;
  /** Whether the window is fullscreen. See {@link TitleBar}. */
  fullscreen: boolean;
  /** The window's motion, which the bar plays too. */
  motion: WindowMotion;
  /** Where a dragged tiled window would land if dropped now. */
  onAim: (aim: Aim | undefined) => void;
  onClose: () => void;
  onDrop: () => void;
  /** A tiled window dropped where it was aimed. See `useTileDrag`. */
  onDropOn: (aim: Aim) => void;
  onFullscreen: () => void;
  onMotionEnded: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  /**
   * Where the bar is drawn. Taken from the placement, not the float, which a
   * fullscreen window does not use.
   */
  rect: Rect;
  /** The window's restack animation, which the bar plays too. */
  restack?: Restack | undefined;
  /** The tab strip direction. See {@link TitleBar}. */
  tabbed: TabLayout | undefined;
  /** What a tiled window can be dropped on, on every screen. */
  targets: DropTargets;
  title: string;
  /** The window this bar names. See {@link TitleBar}. */
  window: string;
};

/**
 * A window's title bar, for both tiled and floating windows.
 *
 * One component for both, so toggling floating does not remount the bar and
 * make it jump while the contents ease to the new box.
 *
 * A floating window's bar drags it without the modifier; a bar never resizes.
 * A tiled window's bar or tab drags like a modifier drag (`useTileDrag`), with
 * the primary button only, onto any screen. A middle click closes a tab. A
 * fullscreen window's bar does not drag.
 */
export const WindowTitleBar = ({
  besideOpenTab,
  depth,
  dragging,
  float,
  focus,
  frame,
  fullscreen,
  groupSelected,
  motion,
  onAim,
  onClose,
  onDrop,
  onDropOn,
  onFullscreen,
  onGrab,
  onMotionEnded,
  onMove,
  rect,
  restack,
  tabbed,
  targets,
  title,
  window,
}: Props) => {
  // Both hooks run for every bar, since hooks cannot be conditional.
  const floatDrag = useFloatDrag({
    float,
    onDrop,
    onGrab,
    onMove,
    onResize: doesNotResize,
    resizes: false,
  });
  const tileDrag = useTileDrag({
    frame,
    id: window,
    onAim,
    onDrop,
    onDropOn,
    onGrab,
    onStretch: doesNotStretch,
    resizes: false,
    targets,
  });
  return (
    <TitleBar
      besideOpenTab={besideOpenTab}
      depth={depth}
      dragging={dragging}
      focus={focus}
      frame={frame}
      fullscreen={fullscreen}
      groupSelected={groupSelected}
      motion={motion}
      onClose={onClose}
      onFullscreen={onFullscreen}
      onMiddleClick={tabbed === undefined ? undefined : onClose}
      onMotionEnded={onMotionEnded}
      rect={rect}
      restack={restack}
      tabbed={tabbed}
      title={title}
      window={window}
      {...dragOf(float, fullscreen, floatDrag, tileDrag)}
    />
  );
};

/** Never called: a bar does not resize. */
const doesNotResize = () => {
  throw new Error("window title bar: a bar does not resize its window");
};

/** Never called: a tiled window's bar only moves it. */
const doesNotStretch = () => {
  throw new Error("window title bar: a bar does not resize its window");
};

/**
 * The drag handlers for a bar: a float's, a tiled window's (primary button
 * only), or none for a fullscreen window.
 */
const dragOf = (
  float: Float | undefined,
  fullscreen: boolean,
  { drag: _floatDrag, ...floatHandlers }: FloatDrag,
  tileDrag: TileDrag,
): {
  onContextMenu?: (event: { preventDefault: () => void }) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
} => {
  if (float !== undefined) {
    return floatHandlers;
  } else if (fullscreen) {
    return {};
  } else {
    return {
      onPointerDown: (event) => {
        if (event.button === PRIMARY_BUTTON) {
          tileDrag.onPointerDown(event);
        }
      },
    };
  }
};
