import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";

import { css } from "../../styled-system/css";

/** The most a badge counts to before it says "and more". */
const MOST_COUNTED = 9;

type Props = {
  /** How many arrived since the drawer was last opened. */
  unread: number;
  /** Open the drawer. */
  onOpen: () => void;
};

/**
 * The bell at the far end of the bar: what opens the drawer of notifications,
 * and how many arrived since it was last opened.
 *
 * The bar's last control, and the drawer slides out from the same edge, so the
 * bell is where the drawer comes from. It rings once whenever the count goes
 * up — the toast is what is read; this is what says there is something to go
 * back to once the toast has gone.
 */
export const NotificationBell = ({ onOpen, unread }: Props) => {
  const label =
    unread === 0 ? "Notifications" : `Notifications, ${unread} unread`;
  return (
    <button
      aria-label={label}
      className={buttonStyles}
      data-unread={unread > 0 ? "" : undefined}
      onClick={onOpen}
      title={label}
      type="button"
    >
      {/*
        Keyed on the count, so a new arrival is a new element and the swing
        plays again: an animation does not restart for a class it already has.
      */}
      <span aria-hidden className={bellStyles} key={unread}>
        <BellSimpleIcon size={15} weight="fill" />
      </span>
      {unread > 0 && (
        <span aria-hidden className={badgeStyles}>
          {unread > MOST_COUNTED ? `${MOST_COUNTED}+` : unread}
        </span>
      )}
    </button>
  );
};

// The theme toggle's shape beside it: a round, borderless control in the
// bar's own white, lit on hover.
const buttonStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  cursor: "pointer",
  display: "inline-flex",
  flexShrink: 0,
  inlineSize: 7,
  justifyContent: "center",
  padding: 0,
  position: "relative",
  transition: "background-color {durations.fast} {easings.default}",
});

const bellStyles = css({
  "[data-unread] > &": {
    animationDuration: "{durations.slowest}",
    animationName: "bellRing",
    animationTimingFunction: "{easings.out}",
  },
  display: "inline-flex",
  // Hung from the top, which is where a bell swings from. Physical, because
  // a bell does not hang from the start of a line.
  transformOrigin: "top center",
});

// A count in a pill on the bell's shoulder, in the accent, so it is the one
// spot of color on a bar that is otherwise white over a photograph — and with
// the bar's own text shadow taken off, which would smudge figures this small.
const badgeStyles = css({
  _starting: {
    transform: "scale(0)",
  },
  alignItems: "center",
  backgroundColor: "accent",
  blockSize: 3.5,
  borderRadius: "full",
  boxShadow: "lifted",
  color: "background",
  display: "inline-flex",
  fontSize: "0.5625rem",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "bold",
  insetBlockStart: 0,
  insetInlineEnd: 0,
  justifyContent: "center",
  lineHeight: "none",
  minInlineSize: 3.5,
  paddingInline: 0.75,
  pointerEvents: "none",
  position: "absolute",
  textShadow: "none",
  transform: "scale(1)",
  transition: "transform {durations.normal} {easings.outBack}",
});
