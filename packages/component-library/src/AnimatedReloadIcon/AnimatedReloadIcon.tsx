import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { ARROW_CLOCKWISE_REGULAR } from "../_icon/phosphor-parts";
import { X_REGULAR } from "../_icon/redrawn-parts";

/** Which way each of the X's strokes swings. */
const SWINGS = [
  [-1, 0],
  [1, 0],
] as const;

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  /** Whether the page is loading: the icon then offers to stop it. */
  loading: boolean;
  size: number;
};

/**
 * Phosphor's regular `ArrowClockwise`, to reload, and its `X` while the page
 * loads, to stop. Pointed at, the arrow winds forward or the X snips. When
 * loading starts the arrow spins away into the X, and it spins back once
 * the page has loaded.
 */
export const AnimatedReloadIcon = ({ label, loading, size }: Props) => (
  <IconFrame label={label} size={size}>
    <IconPart
      d={ARROW_CLOCKWISE_REGULAR.arrow}
      hoverStyles={loading ? undefined : windStyles}
      name="arrow"
      state={loading ? "hidden" : "shown"}
      stateStyles={arrowStyles}
    />
    {X_REGULAR.arms.map((d, index) => (
      <IconPart
        d={d}
        direction={SWINGS[index]}
        hoverStyles={loading ? snipStyles : undefined}
        key={d}
        name="arm"
        order={index}
        state={loading ? "shown" : "hidden"}
        stateStyles={armStyles}
      />
    ))}
  </IconFrame>
);

const arrowStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "rotate(180deg) scale(0.6)",
    transition:
      "opacity {durations.normal} {easings.in}, transform {durations.slow} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} {durations.faster}, transform {durations.slowest} {easings.outBack} {durations.faster}",
  },
});

// Each stroke turns in from its own side.
const armStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "rotate(calc(var(--part-x) * 45deg)) scale(0.5)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} {durations.fast}, transform {durations.slower} {easings.outBack} {durations.fast}",
  },
});

const windStyles = css({
  _controlHover: {
    animation: "iconArrowWind {durations.slowest} {easings.in-out}",
  },
});

const snipStyles = css({
  _controlHover: {
    animation: "iconArmSwing {durations.slower} {easings.in-out}",
  },
  "--swing": "14deg",
});
