import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { CHAT_BOLD } from "../_icon/phosphor-parts";
import { useCue } from "../_icon/useCue";
import "../stylesheet";

/** Where each line starts writing from. */
const LINE_STARTS = [
  [84, 108],
  [84, 148],
] as const;

type Props = {
  /** Plays each time it changes, such as to a higher unread count. */
  cue?: unknown;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's bold `ChatCircleText`. On each cue the bubble tips on its tail
 * and its lines write in, one after the other; pointed at, it tips.
 */
export const AnimatedChatIcon = ({ cue, label, size }: Props) => {
  const cued = useCue(cue);
  return (
    <IconFrame label={label} size={size}>
      <IconPart
        cue={cued}
        cueStyles={bubbleTipStyles}
        d={CHAT_BOLD.bubble}
        hoverStyles={bubbleHoverStyles}
        name="bubble"
        origin={[32, 228]}
      />
      {CHAT_BOLD.lines.map((d, index) => (
        <IconPart
          cue={cued}
          cueStyles={lineWriteStyles}
          d={d}
          key={d}
          name="line"
          order={index}
          origin={LINE_STARTS[index]}
        />
      ))}
    </IconFrame>
  );
};

const bubbleTipStyles = css({
  "&[data-cued]": {
    animation: "iconBubbleTip {durations.slowest} {easings.in-out}",
  },
});

const bubbleHoverStyles = css({
  _controlHover: {
    animation: "iconBubbleTip {durations.slower} {easings.in-out}",
  },
});

const lineWriteStyles = css({
  "&[data-cued]": {
    animation:
      "iconLineWrite {durations.slow} {easings.out} calc({durations.faster} + var(--part-order) * {durations.fast}) both",
  },
});
