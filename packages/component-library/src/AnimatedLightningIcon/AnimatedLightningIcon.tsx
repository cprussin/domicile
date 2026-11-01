import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { LIGHTNING_FILL } from "../_icon/phosphor-parts";
import "../stylesheet";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
  /** Where it sits, inside an outer drawing such as a battery. */
  x?: number | undefined;
  y?: number | undefined;
};

/**
 * Phosphor's filled `Lightning`. It strikes down from its top when it
 * appears, such as when charging starts.
 */
export const AnimatedLightningIcon = ({ label, size, x, y }: Props) => (
  <IconFrame label={label} size={size} x={x} y={y}>
    <IconPart d={LIGHTNING_FILL.bolt} name="bolt" stateStyles={strikeStyles} />
  </IconFrame>
);

const strikeStyles = css({
  animation: "iconBoltStrike {durations.slowest} {easings.linear}",
});
