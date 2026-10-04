import { useState } from "react";

import { css } from "../../../styled-system/css";
import { zoomPercent } from "./zoom-steps";

type Props = {
  /** The page zoom factor. */
  zoom: number;
};

/**
 * Briefly shows the new zoom level after a zoom, like Chrome's zoom bubble.
 *
 * The caller keys it per zoom so each one restarts the animation. It hides on
 * `animationend`, not a timer, so the duration lives only in the stylesheet.
 */
export const ZoomIndicator = ({ zoom }: Props) => {
  const [showing, setShowing] = useState(true);

  return showing ? (
    <output
      className={indicatorStyles}
      onAnimationEnd={() => {
        setShowing(false);
      }}
    >
      {zoomPercent(zoom)}
    </output>
  ) : undefined;
};

// Below the zoom controls, over the page. Ignores the pointer so it never
// blocks the page.
const indicatorStyles = css({
  animation: "zoomAnnounced {durations.notice} {easings.out} forwards",
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  boxShadow: "lifted",
  color: "foreground",
  fontSize: "sm",
  fontVariantNumeric: "tabular-nums",
  insetBlockStart: "100%",
  insetInlineEnd: 2,
  marginBlockStart: 2,
  paddingBlock: 1.5,
  paddingInline: 3,
  pointerEvents: "none",
  position: "absolute",
});
