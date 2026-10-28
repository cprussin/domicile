import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { MICROPHONE_FILL, MICROPHONE_REGULAR } from "../_icon/phosphor-parts";
import { useCue } from "../_icon/useCue";

const PARTS = { fill: MICROPHONE_FILL, regular: MICROPHONE_REGULAR };

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  muted: boolean;
  size: number;
  weight: keyof typeof PARTS;
};

/**
 * Phosphor's `Microphone` and `MicrophoneSlash` in one. Muting draws the
 * slash; unmuting, or pointing at the control the icon is in, bobs the
 * capsule.
 */
export const AnimatedMicrophoneIcon = ({
  label,
  muted,
  size,
  weight,
}: Props) => {
  const unmuted = useCue(muted ? undefined : "live");
  return (
    <IconFrame label={label} size={size} slash={{ shown: muted, weight }}>
      <IconPart
        cue={unmuted}
        cueStyles={capsuleBobStyles}
        d={PARTS[weight].capsule}
        hoverStyles={muted ? undefined : capsuleHoverStyles}
        name="capsule"
      />
      <IconPart d={PARTS[weight].stand} name="stand" />
    </IconFrame>
  );
};

const capsuleBobStyles = css({
  "&[data-cued]": {
    animation: "iconCapsuleBob {durations.slowest} {easings.in-out}",
  },
});

const capsuleHoverStyles = css({
  _controlHover: {
    animation: "iconCapsuleBob {durations.slowest} {easings.in-out}",
  },
});
