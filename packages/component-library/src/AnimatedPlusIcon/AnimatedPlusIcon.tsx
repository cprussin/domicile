import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { PLUS_BOLD, PLUS_REGULAR } from "../_icon/redrawn-parts";
import "../stylesheet";

/** The way each arm reaches: across, then down. */
const REACHES = [
  [1, 0],
  [0, 1],
] as const;

const ARMS = { bold: PLUS_BOLD.arms, regular: PLUS_REGULAR.arms };

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
  weight?: keyof typeof ARMS | undefined;
};

/**
 * Phosphor's `Plus`. Its arms reach out, one after the other, while
 * the control it is in is pointed at.
 */
export const AnimatedPlusIcon = ({
  label,
  size,
  weight = "regular",
}: Props) => (
  <IconFrame label={label} size={size}>
    {ARMS[weight].map((d, index) => (
      <IconPart
        d={d}
        direction={REACHES[index]}
        hoverStyles={reachStyles}
        key={d}
        name="arm"
        order={index}
      />
    ))}
  </IconFrame>
);

const reachStyles = css({
  _controlHover: {
    animation:
      "iconArmReach {durations.slower} {easings.in-out} calc(var(--part-order) * {durations.faster}) both",
  },
});
