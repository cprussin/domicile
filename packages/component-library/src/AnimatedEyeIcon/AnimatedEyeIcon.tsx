import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { EYE_BOLD } from "../_icon/phosphor-parts";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  /** Phosphor's `Eye` while open, `EyeClosed` while shut. */
  open: boolean;
  size: number;
};

/**
 * Phosphor's bold `Eye` and `EyeClosed` in one. Shutting blinks the eye
 * closed; opening widens it and the pupil comes back. Pointed at while open,
 * the pupil looks one way and the other.
 */
export const AnimatedEyeIcon = ({ label, open, size }: Props) => {
  const openState = open ? "shown" : "hidden";
  return (
    <IconFrame label={label} size={size}>
      <IconPart
        d={EYE_BOLD.outline}
        name="outline"
        state={openState}
        stateStyles={outlineStyles}
      />
      <IconPart
        d={EYE_BOLD.pupil}
        hoverStyles={open ? pupilGlanceStyles : undefined}
        name="pupil"
        state={openState}
        stateStyles={pupilStyles}
      />
      <IconPart
        d={EYE_BOLD.closed}
        name="closed"
        state={open ? "hidden" : "shown"}
        stateStyles={closedStyles}
      />
    </IconFrame>
  );
};

// Shutting squeezes the outline flat, then lets it go.
const outlineStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "scaleY(0.08)",
    transition:
      "transform {durations.fast} {easings.in}, opacity {durations.fastest} {easings.linear} {durations.fast}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "transform {durations.slow} {easings.outBack} {durations.faster}, opacity {durations.fastest} {easings.linear} {durations.faster}",
  },
});

const pupilStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "scaleY(0.08)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.slow} {easings.out} {durations.normal}, transform {durations.slow} {easings.outBack} {durations.normal}",
  },
});

const closedStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "translateY(-10px) scaleY(0.5)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} {durations.fast}, transform {durations.normal} {easings.out} {durations.fast}",
  },
});

const pupilGlanceStyles = css({
  _controlHover: {
    animation: "iconPupilGlance calc({durations.slowest} * 2) {easings.in-out}",
  },
});
