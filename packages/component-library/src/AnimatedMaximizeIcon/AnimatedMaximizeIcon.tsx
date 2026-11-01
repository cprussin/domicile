import { css } from "../../styled-system/css";
import { DIAGONALS } from "../_icon/diagonals";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import {
  CORNERS_IN_REGULAR,
  CORNERS_OUT_REGULAR,
} from "../_icon/phosphor-parts";
import "../stylesheet";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  /** Whether the window is maximized: the icon then offers to restore it. */
  maximized: boolean;
  size: number;
};

/**
 * Phosphor's regular `CornersOut` while a window is not maximized, and its
 * `CornersIn` while it is. Pointed at, the corners push out or pull in. On a
 * change they travel that way into the other icon: out to maximize, in to
 * restore.
 */
export const AnimatedMaximizeIcon = ({ label, maximized, size }: Props) => (
  <IconFrame label={label} size={size}>
    {CORNERS_OUT_REGULAR.corners.map((d, index) => (
      <IconPart
        d={d}
        direction={DIAGONALS[index]}
        hoverStyles={maximized ? undefined : pushStyles}
        key={d}
        name="corner-out"
        state={maximized ? "hidden" : "shown"}
        stateStyles={outStyles}
      />
    ))}
    {CORNERS_IN_REGULAR.corners.map((d, index) => (
      <IconPart
        d={d}
        direction={DIAGONALS[index]}
        hoverStyles={maximized ? pullStyles : undefined}
        key={d}
        name="corner-in"
        state={maximized ? "shown" : "hidden"}
        stateStyles={inStyles}
      />
    ))}
  </IconFrame>
);

// Pointing out, they sit further out while hidden.
const outStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform:
      "translate(calc(var(--part-x) * 28px), calc(var(--part-y) * 28px))",
    transition:
      "opacity {durations.normal} {easings.in}, transform {durations.normal} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} {durations.faster}, transform {durations.slower} {easings.outBack} {durations.faster}",
  },
});

// Pointing in, they sit further in while hidden.
const inStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform:
      "translate(calc(var(--part-x) * -28px), calc(var(--part-y) * -28px))",
    transition:
      "opacity {durations.normal} {easings.in}, transform {durations.normal} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} {durations.faster}, transform {durations.slower} {easings.outBack} {durations.faster}",
  },
});

const pushStyles = css({
  _controlHover: {
    animation: "iconPartSpread {durations.slowest} {easings.in-out}",
  },
  "--spread": "14px",
});

const pullStyles = css({
  _controlHover: {
    animation: "iconPartSpread {durations.slowest} {easings.in-out}",
  },
  "--spread": "-10px",
});
