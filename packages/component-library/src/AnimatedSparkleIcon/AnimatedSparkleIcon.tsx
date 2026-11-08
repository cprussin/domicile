import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { SPARKLE_REGULAR } from "../_icon/phosphor-parts";
import "../stylesheet";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's regular `Sparkle`. While the control it is in is pointed at, its
 * star twists a quarter turn and its glints wink out and back one after the
 * other; pressed, the star shrinks a little.
 */
export const AnimatedSparkleIcon = ({ label, size }: Props) => (
  <IconFrame label={label} size={size}>
    <IconPart
      d={SPARKLE_REGULAR.star}
      hoverStyles={twinkleStyles}
      name="star"
      origin={STAR}
      stateStyles={pressStyles}
    />
    {SPARKLE_REGULAR.glints.map((d, index) => (
      <IconPart
        d={d}
        hoverStyles={winkStyles}
        key={d}
        name="glint"
        order={index}
        origin={GLINTS[index]}
      />
    ))}
  </IconFrame>
);

/** The middle of each part, on the 256-unit grid. */
const STAR = [112, 144] as const;
const GLINTS = [
  [176, 40],
  [224, 88],
] as const;

const twinkleStyles = css({
  _controlHover: {
    animation: "iconSparkleTwinkle {durations.slowest} {easings.in-out}",
  },
});

// After the star starts, one glint after the other.
const winkStyles = css({
  _controlHover: {
    animation:
      "iconSparkleWink {durations.slow} {easings.out} calc((var(--part-order) + 1) * {durations.fast})",
  },
});

const pressStyles = css({
  _controlActive: { transform: "scale(0.85)" },
  transition: "transform {durations.fast} {easings.out}",
});
