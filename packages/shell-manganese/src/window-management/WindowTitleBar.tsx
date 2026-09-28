import type { Float } from "./floating/float";
import { useFloatDrag } from "./floating/useFloatDrag";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { TitleBar } from "./TitleBar";
import type { TitleFocus } from "./title-focus";
import type { TabLayout } from "./tree/frames";
import type { WindowMotion } from "./window-motion";

type Props = {
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
  onClose: () => void;
  onDrop: () => void;
  onFullscreen: () => void;
  onMotionEnded: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  onReach: () => void;
  /**
   * Where the bar is drawn: the placement's rather than the float's own, which
   * a fullscreen window has left for the whole screen.
   */
  rect: Rect;
  /** What that window is shuffling, which its bar does with it. */
  restack?: Restack | undefined;
  /** Which way the tabs it is one of run — see {@link TitleBar}. */
  tabbed: TabLayout | undefined;
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
 * is the opposite one. A tiled window's bar is not dragged at all: an ordinary
 * drag on it is a click, and only the desktop's modifier picks a tiled window
 * up.
 */
export const WindowTitleBar = ({
  depth,
  dragging,
  float,
  focus,
  frame,
  fullscreen,
  motion,
  onClose,
  onDrop,
  onFullscreen,
  onGrab,
  onMotionEnded,
  onMove,
  onReach,
  rect,
  restack,
  tabbed,
  title,
  window,
}: Props) => {
  // Called for a tiled window as well, because a hook cannot be called for
  // some renders and not others — and this component is rendered for both.
  const { drag: _drag, ...handlers } = useFloatDrag({
    float,
    onDrop,
    onGrab,
    onMove,
    onResize: doesNotResize,
    resizes: false,
  });
  return (
    <TitleBar
      depth={depth}
      dragging={dragging}
      focus={focus}
      frame={frame}
      fullscreen={fullscreen}
      motion={motion}
      onClose={onClose}
      onFullscreen={onFullscreen}
      onMotionEnded={onMotionEnded}
      onReach={onReach}
      rect={rect}
      restack={restack}
      tabbed={tabbed}
      title={title}
      window={window}
      {...(float === undefined ? {} : handlers)}
    />
  );
};

/** A bar has no corner to resize from, so this is never called. */
const doesNotResize = () => {
  throw new Error("window title bar: a bar does not resize its window");
};
