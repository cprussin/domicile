import type { CSSProperties } from "react";

import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { CARET_REGULAR } from "../_icon/redrawn-parts";
import "../stylesheet";

/** Which way the caret points. */
export type CaretPointing = keyof typeof CARET_REGULAR;

/** The way each pointing darts. Physical, since the icon does not mirror. */
const DARTS: Record<CaretPointing, readonly [number, number]> = {
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
};

/** Each arm turns toward the other, sharpening the point. */
const SWINGS = [
  [1, 0],
  [-1, 0],
] as const;

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  pointing: CaretPointing;
  size: number;
};

/**
 * Phosphor's regular carets. While the control it is in is pointed at, its
 * point sharpens and darts the way it points.
 */
export const AnimatedCaretIcon = ({ label, pointing, size }: Props) => {
  const { arms, tip } = CARET_REGULAR[pointing];
  const [x, y] = DARTS[pointing];
  return (
    <IconFrame label={label} size={size}>
      <g
        className={dartStyles}
        style={{ "--part-x": x, "--part-y": y } as CSSProperties}
      >
        {arms.map((d, index) => (
          <IconPart
            d={d}
            direction={SWINGS[index]}
            hoverStyles={sharpenStyles}
            key={d}
            name="arm"
            order={index}
            origin={tip}
          />
        ))}
      </g>
    </IconFrame>
  );
};

const dartStyles = css({
  _controlHover: {
    animation: "iconPartSpread {durations.slower} {easings.in-out}",
  },
  "--spread": "10px",
  "[data-reduced-motion] &": { animationName: "none !important" },
});

const sharpenStyles = css({
  _controlHover: {
    animation: "iconArmSwing {durations.slower} {easings.in-out}",
  },
  "--swing": "9deg",
});
