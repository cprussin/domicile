import type { Rect } from "../rect";
import { barOf } from "../rect";
import { TitleBar } from "../TitleBar";
import type { TitleFocus } from "../title-focus";
import type { WindowMotion } from "../window-motion";
import type { Float } from "./float";
import { rectOf } from "./float";
import { useFloatDrag } from "./useFloatDrag";

type Props = {
  /** How it stacks, which is the depth of the window it names. */
  depth: number;
  /** Whether the user has hold of this window — see {@link TitleBar}. */
  dragging: boolean;
  float: Float;
  /** What its bar says about the keyboard — see `title-focus.ts`. */
  focus: TitleFocus;
  /** The whole box of the window it names — see {@link TitleBar}. */
  frame: Rect;
  /** What that window is doing, which its bar does with it. */
  motion: WindowMotion;
  onClose: () => void;
  onDrop: () => void;
  onMotionEnded: () => void;
  onGrab: () => void;
  onMove: (x: number, y: number) => void;
  onReach: () => void;
  title: string;
};

/**
 * A floating window's title bar: the same bar every window has, and draggable.
 *
 * Draggable with no modifier held, for the same reason it is chrome at all:
 * the pointer over a client's surface belongs to the client, and the pointer
 * over this belongs to the page. The desktop's modifier is only needed for the
 * rest of the window. A bar never resizes — the corner a resize is driven from
 * is the opposite one.
 *
 * Its own component rather than a prop on {@link TitleBar} because the drag is
 * a hook, and a hook cannot be called for some of a list and not the rest: a
 * tiled window's bar has nowhere to be dragged to, and this is the one that
 * has the drag.
 */
export const FloatTitleBar = ({
  depth,
  dragging,
  float,
  focus,
  frame,
  motion,
  onClose,
  onDrop,
  onGrab,
  onMotionEnded,
  onMove,
  onReach,
  title,
}: Props) => {
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
      motion={motion}
      onClose={onClose}
      onMotionEnded={onMotionEnded}
      onReach={onReach}
      rect={barOf(rectOf(float))}
      title={title}
      window={float.id}
      {...handlers}
    />
  );
};

/** A bar has no corner to resize from, so this is never called. */
const doesNotResize = () => {
  throw new Error("float title bar: a bar does not resize its window");
};
