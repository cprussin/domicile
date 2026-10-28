import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { GEAR_REGULAR } from "../_icon/phosphor-parts";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's regular `GearSix`. It turns one tooth and settles while the
 * control it is in is pointed at.
 */
export const AnimatedGearIcon = ({ label, size }: Props) => (
  <IconFrame label={label} size={size}>
    <IconPart d={GEAR_REGULAR.gear} hoverStyles={gearTurnStyles} name="gear" />
  </IconFrame>
);

const gearTurnStyles = css({
  _controlHover: {
    animation: "iconGearTurn {durations.slowest} {easings.outBack}",
  },
});
