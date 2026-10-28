import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { CHECK_BOLD } from "../_icon/phosphor-parts";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's bold `Check`. It draws from its start when it appears, such as
 * when something has finished.
 */
export const AnimatedCheckIcon = ({ label, size }: Props) => (
  <IconFrame label={label} size={size}>
    <IconPart d={CHECK_BOLD.check} name="check" stateStyles={drawStyles} />
  </IconFrame>
);

const drawStyles = css({
  animation: "iconCheckDraw {durations.slow} {easings.out}",
});
