import type { CSSProperties } from "react";

import { cva } from "../../styled-system/css";
import type { Rect } from "../rect";
import type { Seen } from "./sight";

/**
 * The wrapper around each part of a window, as the overview sees it. A shown
 * workspace eases into its tile and back; a hidden one's windows fade in, and
 * fade out as the overview closes.
 *
 * `emphasized`, as a workspace switch: the move is up to a screen's size.
 */
export const seenStyles = cva({
  base: {
    transformOrigin: "0 0",
    transition: `
      transform {durations.slower} {easings.emphasized},
      opacity {durations.slow} {easings.out}
    `,
  },
  variants: {
    // Its workspace is not under the pointer once the picker is gone. The
    // tab strips turn their own buttons' `pointer-events` back on, so this
    // reaches every part.
    fading: {
      false: {},
      true: { "& *": { pointerEvents: "none!" }, pointerEvents: "none" },
    },
    showing: {
      false: {},
      true: { animation: "overviewShowing {durations.slow} {easings.out}" },
    },
  },
});

/**
 * Inline style showing part of a window through `seen`, clipped to its
 * `screen` so a float hanging off the edge stays in its tile, or none outside
 * the overview.
 *
 * The transform makes the wrapper a stacking context, so it takes the part's
 * own `depth`: the parts still stack as they would at full size.
 */
export const seenAt = (
  seen: Seen | undefined,
  screen: Rect | undefined,
  depth: number,
): CSSProperties => {
  if (seen === undefined || screen === undefined) {
    return {};
  } else {
    const { scale, x, y } = seen.view;
    const top = `${screen.y.toString()}px`;
    const right = `${(screen.x + screen.width).toString()}px`;
    const bottom = `${(screen.y + screen.height).toString()}px`;
    const left = `${screen.x.toString()}px`;
    return {
      clip: `rect(${top}, ${right}, ${bottom}, ${left})`,
      opacity: seen.fading ? 0 : 1,
      transform: `matrix(${scale.toString()}, 0, 0, ${scale.toString()}, ${x.toString()}, ${y.toString()})`,
      zIndex: depth,
    };
  }
};
