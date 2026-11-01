import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { BELL_FILL } from "../_icon/phosphor-parts";
import { useCue } from "../_icon/useCue";
import "../stylesheet";

/** Where the bell hangs from. */
const PIVOT = [128, 24] as const;

type Props = {
  /** Swings the bell each time it changes, such as to a higher unread count. */
  cue?: unknown;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  /** Strikes the bell through, such as while do not disturb is on. */
  off?: boolean | undefined;
  size: number;
};

/**
 * Phosphor's filled `BellSimple`. It swings, its clapper lagging, on each
 * cue, and nudges while the control it is in is pointed at. A slash draws
 * across it while it is `off`.
 */
export const AnimatedBellIcon = ({ cue, label, off = false, size }: Props) => {
  const cued = useCue(cue);
  return (
    <IconFrame label={label} size={size} slash={{ shown: off, weight: "fill" }}>
      <IconPart
        cue={cued}
        cueStyles={bodySwingStyles}
        d={BELL_FILL.body}
        hoverStyles={bodyNudgeStyles}
        name="body"
        origin={PIVOT}
      />
      <IconPart
        cue={cued}
        cueStyles={clapperSwingStyles}
        d={BELL_FILL.clapper}
        name="clapper"
        origin={PIVOT}
      />
    </IconFrame>
  );
};

const bodySwingStyles = css({
  "&[data-cued]": {
    animation:
      "iconBellSwing calc({durations.slowest} + {durations.normal}) {easings.linear}",
  },
});

const clapperSwingStyles = css({
  "&[data-cued]": {
    animation:
      "iconBellClapper calc({durations.slowest} + {durations.normal}) {easings.linear} {durations.fastest}",
  },
});

const bodyNudgeStyles = css({
  _controlHover: {
    animation: "iconBellNudge {durations.slowest} {easings.in-out}",
  },
});
