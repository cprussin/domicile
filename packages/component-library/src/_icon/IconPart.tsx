import type { CSSProperties } from "react";

import { css, cx } from "../../styled-system/css";

type Props = {
  /** Replays `cueStyles` each time it goes up; see `useCue`. */
  cue?: number | undefined;
  /** The animation each cue plays. */
  cueStyles?: string | undefined;
  d: string;
  /**
   * The way it moves in motions that move parts apart, from -1 to 1 on each
   * axis, as `--part-x` and `--part-y`.
   */
  direction?: readonly [number, number] | undefined;
  /** The animation played while the control the icon is in is pointed at. */
  hoverStyles?: string | undefined;
  /** What the part is, for styles and tests: "clapper", "arc". */
  name: string;
  /** Its place among parts of the same name, for staggering them. */
  order?: number | undefined;
  /** The point it turns and scales about, on the 256-unit grid. */
  origin?: readonly [number, number] | undefined;
  /** Its state, as `data-state`, such as `lit` or `unlit`. */
  state?: string | undefined;
  /** How it looks in each `state`, and the transition into it. */
  stateStyles?: string | undefined;
};

/**
 * One part of an animated icon. Its state, its cue and its hover motion each
 * get their own group, so they add up rather than replace one another: the
 * bell can swing for a new notification while it is pointed at.
 */
export const IconPart = ({
  cue = 0,
  cueStyles,
  d,
  direction = [0, 0],
  hoverStyles,
  name,
  order = 0,
  origin = [128, 128],
  state,
  stateStyles,
}: Props) => (
  <g
    className={cx(partStyles, stateStyles)}
    data-part={name}
    data-state={state}
    style={
      {
        "--part-order": order,
        "--part-origin": `${origin[0].toString()}px ${origin[1].toString()}px`,
        "--part-x": direction[0],
        "--part-y": direction[1],
      } as CSSProperties
    }
  >
    <g
      className={cx(partStyles, cueStyles)}
      data-cued={cue > 0 ? "" : undefined}
      key={cue}
    >
      <g className={cx(partStyles, hoverStyles)}>
        <path d={d} />
      </g>
    </g>
  </g>
);

// Every animation is a flourish; state changes are transitions, which reduced
// motion shortens. So reduced motion drops the animations.
const partStyles = css({
  "[data-reduced-motion] &": { animationName: "none !important" },
  transformBox: "view-box",
  transformOrigin: "var(--part-origin)",
});
