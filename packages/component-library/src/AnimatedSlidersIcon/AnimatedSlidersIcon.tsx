import { useId } from "react";

import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { SLIDERS_REGULAR } from "../_icon/redrawn-parts";

/** The way each knob slides: the top one along, the bottom one back. */
const SLIDES = [
  [1, 0],
  [-1, 0],
] as const;

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's regular `SlidersHorizontal`. Its knobs slide opposite ways and
 * back while the control it is in is pointed at.
 */
export const AnimatedSlidersIcon = ({ label, size }: Props) => {
  const maskId = useId();
  return (
    <IconFrame label={label} size={size}>
      <defs>
        {/* Hide each track where its knob sits, and move with the knob. */}
        {SLIDERS_REGULAR.knobDisks.map((d, index) => (
          <mask
            height="320"
            id={`${maskId}-${index.toString()}`}
            key={d}
            maskUnits="userSpaceOnUse"
            width="320"
            x="-32"
            y="-32"
          >
            <rect fill="white" height="320" width="320" x="-32" y="-32" />
            <g fill="black">
              <IconPart
                d={d}
                direction={SLIDES[index]}
                hoverStyles={slideStyles}
                name="knob-disk"
                order={index}
              />
            </g>
          </mask>
        ))}
      </defs>
      {SLIDERS_REGULAR.tracks.map((d, index) => (
        <g key={d} mask={`url(#${maskId}-${index.toString()})`}>
          <IconPart d={d} name="track" />
        </g>
      ))}
      {SLIDERS_REGULAR.knobs.map((d, index) => (
        <IconPart
          d={d}
          direction={SLIDES[index]}
          hoverStyles={slideStyles}
          key={d}
          name="knob"
          order={index}
        />
      ))}
    </IconFrame>
  );
};

const slideStyles = css({
  _controlHover: {
    animation:
      "iconPartSpread {durations.slowest} {easings.in-out} calc(var(--part-order) * {durations.fastest}) both",
  },
  "--spread": "24px",
});
