import { useRef } from "react";

import { cva, cx } from "../styled-system/css";
import type { Rect } from "./rect";
import { useLowered } from "./useLowered";
import { useSettling } from "./useSettling";
import type { WindowMotion } from "./window-motion";
import { isMoving } from "./window-motion";
import {
  movingStyles,
  originOf,
  placedAt,
  scaledAbout,
  settlingStyles,
} from "./window-styles";

type Props = {
  /** The depth of the windows in it. */
  depth: number;
  /** Whether its group is being dragged, so it follows the pointer. */
  dragging: boolean;
  /**
   * Whether it casts its float's shadow, as the float's outermost well. See
   * `castsFloatShadow`.
   */
  castsShadow: boolean;
  /** The motion of its tab, which it plays too. */
  motion: WindowMotion;
  /** The box under the strip. See `Tab.well`. */
  rect: Rect;
};

/**
 * The backdrop of a group shown in a tab: the open tab's color, hanging from
 * it, with a margin around the group's windows. See `Tab.well`.
 *
 * Drawn before every window and glow at the windows' depth, so they cover it.
 */
export const GroupWell = ({
  castsShadow,
  depth,
  dragging,
  motion,
  rect,
}: Props) => {
  const element = useRef<HTMLDivElement>(null);
  const lowered = useLowered(depth);
  useSettling({
    element,
    origin: originOf(rect, rect),
    rect,
    still: dragging || isMoving(motion),
  });
  return (
    <div
      className={cx(
        wellStyles({ castsShadow }),
        movingStyles({ motion }),
        settlingStyles({ lowered }),
      )}
      data-well
      ref={element}
      style={{
        ...placedAt(rect, depth),
        ...scaledAbout(rect, rect),
      }}
    />
  );
};

/**
 * The open tab's background and edge (see `tabStyles` in `TitleBar`), with no
 * top edge, so the two read as one piece. Rounded at the bottom like a window.
 */
const wellStyles = cva({
  base: {
    backgroundColor:
      "color-mix(in oklab, {colors.foreground} 14%, {colors.background})",
    // Longhands, as for `edgeStyles`.
    borderBlockEndWidth: "1px",
    borderBlockStartWidth: 0,
    borderColor: "borderStrong",
    borderEndEndRadius: "lg",
    borderEndStartRadius: "lg",
    borderInlineWidth: "1px",
    borderStyle: "solid",
    pointerEvents: "none",
  },
  variants: {
    castsShadow: { false: {}, true: { boxShadow: "lifted" } },
  },
});
