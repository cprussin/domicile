import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { MINUS_BOLD } from "../_icon/redrawn-parts";

/** The bar draws in across, the opposite of the plus's arms reaching. */
const DRAWS_IN = [-1, 0] as const;

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's bold `Minus`. Its bar draws in while the control it is in is
 * pointed at.
 */
export const AnimatedMinusIcon = ({ label, size }: Props) => (
  <IconFrame label={label} size={size}>
    <IconPart
      d={MINUS_BOLD.bar}
      direction={DRAWS_IN}
      hoverStyles={drawInStyles}
      name="bar"
    />
  </IconFrame>
);

const drawInStyles = css({
  _controlHover: {
    animation: "iconArmReach {durations.slower} {easings.in-out}",
  },
});
