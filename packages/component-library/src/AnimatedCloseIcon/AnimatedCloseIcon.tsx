import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { X_BOLD, X_REGULAR } from "../_icon/redrawn-parts";
import "../stylesheet";

/** Which way each stroke swings as the X snips. */
const SWINGS = [
  [-1, 0],
  [1, 0],
] as const;

const ARMS = { bold: X_BOLD.arms, regular: X_REGULAR.arms };

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
  weight?: keyof typeof ARMS | undefined;
};

/**
 * Phosphor's `X`. Its two strokes snip, like scissors, while the control it
 * is in is pointed at.
 */
export const AnimatedCloseIcon = ({
  label,
  size,
  weight = "regular",
}: Props) => (
  <IconFrame label={label} size={size}>
    {ARMS[weight].map((d, index) => (
      <IconPart
        d={d}
        direction={SWINGS[index]}
        hoverStyles={snipStyles}
        key={d}
        name="arm"
        order={index}
      />
    ))}
  </IconFrame>
);

const snipStyles = css({
  _controlHover: {
    animation: "iconArmSwing {durations.slower} {easings.in-out}",
  },
  "--swing": "14deg",
});
