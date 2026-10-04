import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";

import { css } from "../../styled-system/css";

/** The highest count the badge shows before it switches to "N+". */
const MOST_COUNTED = 9;

type Props = {
  /** How many arrived since the drawer was last opened. */
  unread: number;
  /** Open the drawer. */
  onOpen: () => void;
};

/**
 * The bar's bell: opens the notification drawer and shows the unseen count.
 *
 * It sits at the bar's far end because the drawer slides out from that edge. It
 * swings when the count goes up, to point back to notifications whose toasts
 * have gone.
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
        Keyed on the count so each new arrival remounts it and replays the
        swing; an animation does not restart for a class it already has.
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

// Matches the theme toggle: round, borderless, in the bar's white, lit on
// hover.
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
  // Swings from the top. A physical property, since the swing does not depend
  // on text direction.
  transformOrigin: "top center",
});

// The count in an accent-colored pill. The bar's text shadow is removed because
// it smudges small figures.
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
