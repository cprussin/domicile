import { CountBadge } from "@domicile-desktop/component-library/CountBadge";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";

import { css } from "../styled-system/css";

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
      <CountBadge count={unread} />
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
