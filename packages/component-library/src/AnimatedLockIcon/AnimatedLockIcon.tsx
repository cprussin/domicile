import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { LOCK_REGULAR } from "../_icon/redrawn-parts";

/** The keyhole's middle, which it swells about. */
const KEYHOLE = [128, 152] as const;

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's regular `Lock`. Its shackle snaps shut when it appears, such as
 * when a page turns out to be secure, and lifts a little while the control
 * it is in is pointed at.
 */
export const AnimatedLockIcon = ({ label, size }: Props) => (
  <IconFrame label={label} size={size}>
    <IconPart d={LOCK_REGULAR.body} name="body" />
    <IconPart
      d={LOCK_REGULAR.shackle}
      hoverStyles={liftStyles}
      name="shackle"
      stateStyles={shutStyles}
    />
    <IconPart
      d={LOCK_REGULAR.keyhole}
      name="keyhole"
      origin={KEYHOLE}
      stateStyles={pulseStyles}
    />
  </IconFrame>
);

const shutStyles = css({
  animation: "iconShackleShut {durations.slower} {easings.out}",
});

const pulseStyles = css({
  animation:
    "iconKeyholePulse {durations.slow} {easings.in-out} {durations.normal} both",
});

const liftStyles = css({
  _controlHover: {
    animation: "iconShackleLift {durations.slowest} {easings.in-out}",
  },
});
