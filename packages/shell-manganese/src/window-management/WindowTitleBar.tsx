import type { PointerEvent as ReactPointerEvent } from "react";

import type { Direction } from "./direction";
import type { Float } from "./floating/float";
import type { FloatDrag } from "./floating/useFloatDrag";
import { useFloatDrag } from "./floating/useFloatDrag";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { TitleBar } from "./TitleBar";
import type { Aim, Target } from "./tiled/aim";
import type { TileDrag } from "./tiled/useTileDrag";
import { useTileDrag } from "./tiled/useTileDrag";
import type { TitleFocus } from "./title-focus";
import type { TabLayout } from "./tree/frames";
import type { WindowMotion } from "./window-motion";

/** The primary button, as `PointerEvent.button` numbers it. */
const PRIMARY_BUTTON = 0;

type Props = {
  /** Whether that window is all the screen shows — see {@link TitleBar}. */
  alone: boolean;
  /** How it stacks, which is the depth of the window it names. */
  depth: number;
  /** Whether the user has hold of this window — see {@link TitleBar}. */
  dragging: boolean;
  /** The window's floating box, or `undefined` while it is tiled. */
  float: Float | undefined;
  /** What its bar says about the keyboard — see `title-focus.ts`. */
  focus: TitleFocus;
  /** The whole box of the window it names — see {@link TitleBar}. */
  frame: Rect;
  /** Whether that window already has the screen — see {@link TitleBar}. */
  fullscreen: boolean;
  /** What that window is doing, which its bar does with it. */
  motion: WindowMotion;
  /** Where a tab dragged out of its container would land if let go of now. */
  onAim: (aim: Aim | undefined) => void;
  onClose: () => void;
  onDrop: () => void;
  /** A tab let go of over a tiled window — see `useTileDrag`. */
  onDropOn: (target: string, edge: Direction | undefined) => void;
  onFullscreen: () => void;
  onMotionEnded: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  /**
   * Where the bar is drawn: the placement's rather than the float's own, which
   * a fullscreen window has left for the whole screen.
   */
  rect: Rect;
  /** What that window is shuffling, which its bar does with it. */
  restack?: Restack | undefined;
  /** Which way the tabs it is one of run — see {@link TitleBar}. */
  tabbed: TabLayout | undefined;
  /** The tiled windows on this screen, which a tab can be dropped on. */
  targets: readonly Target[];
  title: string;
  /** The window this bar names — see {@link TitleBar}. */
  window: string;
};

/**
 * A window's own title bar, tiled or floating: the same bar every window has,
 * and draggable while the window floats.
 *
 * **One component for both, so the bar is one element for both.** Floating a
 * window, or tiling it again, moves its contents to a new box they ease into —
 * the `<app>` is the same element before and after. A bar drawn by a different
 * component on each side would be unmounted and made anew at the new box, and
 * would jump there while the window under it was still on its way.
 *
 * Draggable with no modifier held, for the same reason it is chrome at all:
 * the pointer over a client's surface belongs to the client, and the pointer
 * over this belongs to the page. The desktop's modifier is only needed for the
 * rest of the window. A bar never resizes — the corner a resize is driven from
 * is the opposite one.
 *
 * **A tiled window's tab is dragged the way the desktop's modifier drags the
 * window** — `useTileDrag`'s move, dropped on another tiled window — and a
 * middle click closes it, both as a browser's tabs do. Only the primary button
 * takes hold of one, so the middle one's press is left to be the click. A
 * tiled window's own bar is not dragged at all: an ordinary drag on it is a
 * click, and only the desktop's modifier picks a lone tiled window up.
 */
export const WindowTitleBar = ({
  alone,
  depth,
  dragging,
  float,
  focus,
  frame,
  fullscreen,
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
  // Called for a tiled window as well, because a hook cannot be called for
  // some renders and not others — and this component is rendered for both.
  const floatDrag = useFloatDrag({
    float,
    onDrop,
    onGrab,
    onMove,
    onResize: doesNotResize,
    resizes: false,
  });
  // And for every bar, for the same reason.
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
      alone={alone}
      depth={depth}
      dragging={dragging}
      focus={focus}
      frame={frame}
      fullscreen={fullscreen}
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
      {...dragOf(float, tabbed, floatDrag, tileDrag)}
    />
  );
};

/** A bar has no corner to resize from, so this is never called. */
const doesNotResize = () => {
  throw new Error("window title bar: a bar does not resize its window");
};

/** A tab is only ever moved, so this is never called either. */
const doesNotStretch = () => {
  throw new Error("window title bar: a tab does not resize its window");
};

/**
 * What a press on the bar takes hold of: a float, a tiled window's tab —
 * with the primary button — or nothing.
 */
const dragOf = (
  float: Float | undefined,
  tabbed: TabLayout | undefined,
  { drag: _floatDrag, ...floatHandlers }: FloatDrag,
  tileDrag: TileDrag,
): {
  onContextMenu?: (event: { preventDefault: () => void }) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
} => {
  if (float !== undefined) {
    return floatHandlers;
  } else if (tabbed === undefined) {
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
