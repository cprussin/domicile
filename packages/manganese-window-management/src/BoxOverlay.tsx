import type { HTMLAttributes } from "react";
import { useContext, useRef } from "react";

import { cx } from "../styled-system/css";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { SlidingScreen } from "./sliding-screen";
import { useLowered } from "./useLowered";
import type { Settler } from "./useSettling";
import { useSettling } from "./useSettling";
import type { WindowMotion } from "./window-motion";
import { isMoving } from "./window-motion";
import {
  clippedAlong,
  heldStyles,
  movingStyles,
  originOf,
  placedAt,
  scaledAbout,
  settlingStyles,
  shuffledBy,
} from "./window-styles";

/** Where a `BoxOverlay` sits, and the motion it plays. */
export type BoxOverlayPlacement = {
  /** Its `z-index`. */
  depth: number;
  /** Whether its box is being dragged, so it follows the pointer. */
  dragging: boolean;
  /** The focused window's motion, which the overlay plays too. */
  motion: WindowMotion;
  /** The box it covers. */
  rect: Rect;
  /** The focused window's restack shuffle, if any. */
  restack?: Restack | undefined;
  /** Eases the overlay into a new box with its windows; see `useSettling`. */
  settler?: Settler | undefined;
};

type Props = BoxOverlayPlacement &
  Omit<HTMLAttributes<HTMLDivElement>, "children" | "style">;

/**
 * An element over a box of windows, such as the focus glow or the selection
 * tint, that plays the focused window's motion and moves with its windows.
 * What it looks like is its `className`'s.
 */
export const BoxOverlay = ({
  className,
  depth,
  dragging,
  motion,
  rect,
  restack,
  settler,
  ...attributes
}: Props) => {
  const element = useRef<HTMLDivElement>(null);
  const lowered = useLowered(depth);
  const sliding = useContext(SlidingScreen);
  useSettling({
    dragged: dragging,
    element,
    origin: originOf(rect, rect),
    rect,
    settler,
    still: dragging || isMoving(motion),
  });
  return (
    <div
      {...attributes}
      className={cx(
        className,
        movingStyles({ motion }),
        settlingStyles({ lowered }),
        dragging && heldStyles,
      )}
      ref={element}
      style={{
        ...placedAt(rect, depth),
        ...clippedAlong(sliding, rect),
        ...scaledAbout(rect, rect),
        ...shuffledBy(restack),
      }}
    />
  );
};
