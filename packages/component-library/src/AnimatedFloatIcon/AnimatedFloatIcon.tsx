import { useId } from "react";

import { css } from "../../styled-system/css";
import { DIAGONALS } from "../_icon/diagonals";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { SQUARES_REGULAR } from "../_icon/phosphor-parts";
import { BROWSERS_REGULAR } from "../_icon/redrawn-parts";

/** The centers of the squares, which they shrink about. */
const SQUARE_CENTERS = [
  [80, 80],
  [176, 80],
  [80, 176],
  [176, 176],
] as const;

/** The center of the window in front. */
const FRONT_CENTER = [112, 144] as const;

/** The way the window in front lifts, and the one behind the other way. */
const FRONT_LIFT = [-1, 1] as const;
const BACK_LIFT = [1, -1] as const;

type Props = {
  /** Whether the window floats: the icon then offers to tile it. */
  floating: boolean;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
};

/**
 * Phosphor's regular `Browsers` while a window is tiled, to float it, and
 * its `SquaresFour` while it floats, to tile it. Pointed at, the windows
 * lift apart or the squares part. On a change the windows gather into the
 * squares, or the window behind slides out from the one in front.
 */
export const AnimatedFloatIcon = ({ floating, label, size }: Props) => {
  const maskId = useId();
  const windows = floating ? "hidden" : "shown";
  const squares = floating ? "shown" : "hidden";
  return (
    <IconFrame label={label} size={size}>
      <defs>
        {/* Hides the window behind where the one in front covers it. */}
        <mask
          height="320"
          id={maskId}
          maskUnits="userSpaceOnUse"
          width="320"
          x="-32"
          y="-32"
        >
          <rect fill="white" height="320" width="320" x="-32" y="-32" />
          <g fill="black">
            <IconPart
              d={BROWSERS_REGULAR.frontOutline}
              direction={FRONT_LIFT}
              hoverStyles={floating ? undefined : frontLiftStyles}
              name="front-outline"
            />
          </g>
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <IconPart
          d={BROWSERS_REGULAR.back}
          direction={BACK_LIFT}
          hoverStyles={floating ? undefined : backLiftStyles}
          name="back"
          state={windows}
          stateStyles={backStyles}
        />
      </g>
      <IconPart
        d={BROWSERS_REGULAR.front}
        direction={FRONT_LIFT}
        hoverStyles={floating ? undefined : frontLiftStyles}
        name="front"
        origin={FRONT_CENTER}
        state={windows}
        stateStyles={frontStyles}
      />
      {SQUARES_REGULAR.squares.map((d, index) => (
        <IconPart
          d={d}
          direction={DIAGONALS[index]}
          hoverStyles={floating ? squareSpreadStyles : undefined}
          key={d}
          name="square"
          order={index}
          origin={SQUARE_CENTERS[index]}
          state={squares}
          stateStyles={squareStyles}
        />
      ))}
    </IconFrame>
  );
};

// The window behind tucks under the one in front before either goes, and
// slides back out once the one in front is back.
const backStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "translate(-32px, 32px)",
    transition:
      "opacity {durations.fastest} {easings.linear} {durations.normal}, transform {durations.normal} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.fastest} {easings.linear} {durations.slow}, transform {durations.slower} {easings.outBack} {durations.slow}",
  },
});

const frontStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "scale(0.8)",
    transition:
      "opacity {durations.normal} {easings.in} {durations.fast}, transform {durations.normal} {easings.in} {durations.fast}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} {durations.fast}, transform {durations.slow} {easings.out} {durations.fast}",
  },
});

// The squares gather into the middle as they go, and come out of it.
const squareStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform:
      "translate(calc(var(--part-x) * -30px), calc(var(--part-y) * -30px)) scale(0.6)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.normal} {easings.out} calc({durations.fast} + var(--part-order) * {durations.fastest}), transform {durations.slower} {easings.outBack} calc({durations.fast} + var(--part-order) * {durations.fastest})",
  },
});

const backLiftStyles = css({
  _controlHover: {
    animation: "iconPartSpread {durations.slowest} {easings.in-out}",
  },
  "--spread": "12px",
});

const frontLiftStyles = css({
  _controlHover: {
    animation: "iconPartSpread {durations.slowest} {easings.in-out}",
  },
  "--spread": "8px",
});

const squareSpreadStyles = css({
  _controlHover: {
    animation:
      "iconPartSpread {durations.slowest} {easings.in-out} calc(var(--part-order) * {durations.fastest} / 2)",
  },
  "--spread": "9px",
});
