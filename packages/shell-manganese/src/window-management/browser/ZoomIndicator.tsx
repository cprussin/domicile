import { useState } from "react";

import { css } from "../../../styled-system/css";
import { zoomPercent } from "./zoom-steps";

type Props = {
  /** The page's zoom, as a factor. Followed while it shows. */
  zoom: number;
};

/**
 * The zoom a browser window has just been zoomed to, shown for a moment
 * beside the controls that zoom it — what Chrome's zoom bubble is for, since a
 * Ctrl+plus or a turn of the wheel otherwise changes the page with nothing
 * saying by how much.
 *
 * ONE ZOOM, ONE INDICATOR: whoever draws it keys it by the zoom it announces,
 * so the next one is a fresh element whose animation starts over.
 *
 * Its own animation ending is what puts it away, rather than a timer: how long
 * it shows is the stylesheet's to say, and a duration here as well would be a
 * second copy of it to keep in step.
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

// Hung under the bar's inline end, where the controls it reports on are, and
// over the top of the page: a positioned box paints above the view, which is
// in flow. It takes no pointer, so it never stands between the user and the
// page it is lying across.
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
