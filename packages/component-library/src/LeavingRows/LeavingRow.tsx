import type { CSSProperties, ReactNode, TransitionEvent } from "react";

import { css, cva } from "../../styled-system/css";
import type { Leaving } from "./leaving-rows";
import "../stylesheet";

/** How a row comes and goes. See `useLeavingRows`. */
export type RowMotion = {
  /** It came in while its list showed, so it slides in. */
  arriving: boolean;
  /** Where it is in animating out, while it does. */
  leaving: Leaving | undefined;
  /** How far it rises, in pixels, over the slid out rows above it. */
  rise: number;
  /** It has slid out, and takes `room` pixels, which the rows below rise over. */
  onSlid: (room: number) => void;
  /** The rows below have risen over it. */
  onClosed: () => void;
};

type Props = {
  children: ReactNode;
  motion: RowMotion;
  /** `filled` puts it on its own tile, as a `ListRow` of that surface. */
  surface?: "plain" | "filled" | undefined;
};

/**
 * A list item that slides in as it arrives, and out as it leaves. Once it has
 * slid out, the rows below rise over its room. Several leaving together go in
 * turn, top to bottom. What leaves is out of reach.
 *
 * Every motion is a transform, so none of it lays the list out again. The
 * leaving rows stay in the list until all have been risen over; then they go,
 * and the rows below drop their rise, in one frame.
 *
 * The notification drawer's and the downloads panel's rows move this way.
 */
export const LeavingRow = ({
  children,
  motion: { arriving, leaving, onClosed, onSlid, rise },
  surface = "plain",
}: Props) => (
  <li
    aria-hidden={leaving === undefined ? undefined : true}
    className={rowStyles}
    data-arriving={arriving ? "" : undefined}
    data-closing={leaving?.room === undefined ? undefined : ""}
    data-leaving={leaving === undefined ? undefined : ""}
    // A closing row is out of sight, and rising would take the transition
    // its collapse needs.
    data-rising={rise === 0 || leaving?.room !== undefined ? undefined : ""}
    data-surface={surface}
    inert={leaving !== undefined}
    onTransitionEnd={(event) => {
      if (leaving !== undefined) {
        leaveStep(event, leaving, onSlid, onClosed);
      }
    }}
    style={motionVars(leaving, rise)}
  >
    <div className={bodyStyles({ surface })}>{children}</div>
  </li>
);

// The row rises, and its body slides, so the two never share a `transition`.
// Rising has a transition only while it rises: dropping the rise as the rows
// it rose over go must not animate.
const rowStyles = css({
  // Grows from no height, moving the rows below down rather than jumping them.
  // `@starting-style`, as its body's slide: the row mounts in the list, not in
  // a portal.
  "&[data-arriving]": {
    _starting: { blockSize: 0 },
  },
  // Out of sight by now. Its collapse lasts as long as the rise over it, and
  // its end says the rise has ended, even with no rows below to rise.
  "&[data-closing]": {
    scale: "1 0",
    transformOrigin: "top",
    transition: "scale {durations.springs.snappy} {easings.springs.snappy}",
  },
  "&[data-rising]": {
    // main-thread animation: an arriving row's growth, as below.
    transition:
      "translate {durations.springs.snappy} {easings.springs.snappy}, block-size {durations.springs.smooth} {easings.springs.smooth}",
    translate: "0 calc(-1 * var(--rise))",
  },
  blockSize: "auto",
  // In a column of flex items, so its growth isn't held to its content's
  // height, nor a crowded list squeezing it.
  flexShrink: 0,
  interpolateSize: "allow-keywords",
  minBlockSize: 0,
  minInlineSize: 0,
  // Its body's slide and its growth stay inside it, or a scrolled list would
  // scroll sideways or spill over the rows below. The margin keeps a focus
  // ring.
  overflow: "clip",
  overflowClipMargin: "{spacing.1}",
  // main-thread animation: grows once as it arrives, moving the rows below.
  // A transform would leave the list's height, and the panel's, jumping.
  transition: "block-size {durations.springs.smooth} {easings.springs.smooth}",
});

const bodyStyles = cva({
  base: {
    "[data-arriving] > &": {
      _starting: {
        opacity: 0,
        transform: "translateX({spacing.4})",
      },
    },
    "[data-leaving] > &": {
      opacity: 0,
      pointerEvents: "none",
      transform: "translateX({spacing.6})",
      transition:
        "opacity {durations.normal} {easings.in} calc(var(--leave-order) * {durations.fastest}), transform {durations.springs.snappy} {easings.springs.snappy} calc(var(--leave-order) * {durations.fastest})",
    },
    borderRadius: "lg",
    display: "flex",
    flexDirection: "column",
    minInlineSize: 0,
    opacity: 1,
    transform: "translateX(0)",
    transition:
      "background-color {durations.fast} {easings.default}, opacity {durations.slow} {easings.outQuart}, transform {durations.springs.smooth} {easings.springs.smooth}",
  },
  variants: {
    surface: {
      filled: { backgroundColor: "fill" },
      plain: {},
    },
  },
});

/**
 * Inline style handing the leaving order and the rise to the styles, as
 * `--leave-order` and `--rise`. Inline because Panda only extracts build-time
 * literals.
 */
const motionVars = (
  leaving: Leaving | undefined,
  rise: number,
): CSSProperties & Record<`--${string}`, string> => ({
  ...(leaving === undefined
    ? {}
    : { "--leave-order": String(Math.min(leaving.order, 8)) }),
  ...(rise === 0 ? {} : { "--rise": `${rise}px` }),
});

/**
 * Moves a leaving row on as one of its transitions ends: from sliding out to
 * closing once its body has slid, then to closed once its own collapse ends.
 */
const leaveStep = (
  event: TransitionEvent<HTMLLIElement>,
  { room }: Leaving,
  onSlid: (room: number) => void,
  onClosed: () => void,
) => {
  const row = event.currentTarget;
  if (
    room === undefined &&
    event.target === row.firstElementChild &&
    event.propertyName === "transform"
  ) {
    onSlid(roomOf(row));
  } else if (
    room !== undefined &&
    event.target === row &&
    event.propertyName === "scale"
  ) {
    onClosed();
  }
};

/**
 * The pixels `row` takes in its list, its gap included: down to the next row's
 * top, or its own height when it is last.
 */
const roomOf = (row: HTMLElement): number => {
  const next = row.nextElementSibling;
  return next instanceof HTMLElement
    ? next.offsetTop - row.offsetTop
    : row.offsetHeight;
};
