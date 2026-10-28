import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { KEYBOARD_BOLD } from "../_icon/phosphor-parts";
import { useCue } from "../_icon/useCue";

type Props = {
  /** Plays each time it changes, such as to the keymap in use. */
  cue?: unknown;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's bold `Keyboard`. On each cue its keys press down in a wave, top
 * row first; pointed at, one key presses.
 */
export const AnimatedKeyboardIcon = ({ cue, label, size }: Props) => {
  const cued = useCue(cue);
  return (
    <IconFrame label={label} size={size}>
      <IconPart d={KEYBOARD_BOLD.frame} name="frame" />
      {KEYBOARD_BOLD.keys.map((d, index) => (
        <IconPart
          cue={cued}
          cueStyles={keyWaveStyles}
          d={d}
          hoverStyles={index === 1 ? keyHoverStyles : undefined}
          key={d}
          name="key"
          order={index}
        />
      ))}
    </IconFrame>
  );
};

const keyWaveStyles = css({
  "&[data-cued]": {
    animation:
      "iconKeyPress {durations.slow} {easings.in-out} calc(var(--part-order) * {durations.fastest}) both",
  },
});

const keyHoverStyles = css({
  _controlHover: {
    animation: "iconKeyPress {durations.slow} {easings.in-out}",
  },
});
