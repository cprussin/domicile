import { CountBadge } from "@domicile-desktop/component-library/CountBadge";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import type { NotificationsHandle } from "@domicile-desktop/manganese-notifications/notifications-context";
import { bellId } from "@domicile-desktop/manganese-notifications/notifications-context";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";

import { css } from "../styled-system/css";

type Props = {
  /** Opens the drawer under this bell. */
  handle: NotificationsHandle;
  /** The bar's monitor. */
  screen: string;
  /** How many arrived since the drawer was last opened. */
  unread: number;
};

/**
 * The bar's bell: opens the notification drawer under itself and shows the
 * unseen count.
 *
 * It swings when the count goes up, to point back to notifications whose
 * toasts have gone.
 */
export const NotificationBell = ({ handle, screen, unread }: Props) => {
  const label =
    unread === 0 ? "Notifications" : `Notifications, ${unread} unread`;
  return (
    <Tooltip
      content={label}
      tone="overPhoto"
      trigger={
        <Popover.Trigger
          aria-label={label}
          className={buttonStyles}
          // For `screenOfBell`.
          data-bell-screen={screen}
          data-unread={unread > 0 ? "" : undefined}
          handle={handle}
          id={bellId(screen)}
        >
          {/*
        Keyed on the count so each new arrival remounts it and replays the
        swing; an animation does not restart for a class it already has.
      */}
          <span aria-hidden className={bellStyles} key={unread}>
            <BellSimpleIcon size={15} weight="fill" />
          </span>
          <CountBadge count={unread} />
        </Popover.Trigger>
      }
    />
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
