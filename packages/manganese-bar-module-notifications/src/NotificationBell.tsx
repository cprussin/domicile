import { AnimatedBellIcon } from "@domicile-desktop/component-library/AnimatedBellIcon";
import { CountBadge } from "@domicile-desktop/component-library/CountBadge";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import type { NotificationsHandle } from "@domicile-desktop/manganese-notifications/notifications-context";
import { bellId } from "@domicile-desktop/manganese-notifications/notifications-context";

import { css } from "../styled-system/css";

type Props = {
  /** Opens the drawer under this bell. */
  handle: NotificationsHandle;
  /** Toasts are held back; the bell is struck through. */
  paused: boolean;
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
 * toasts have gone, and not when they are read.
 */
export const NotificationBell = ({ handle, paused, screen, unread }: Props) => {
  const label = [
    "Notifications",
    ...(unread === 0 ? [] : [`${unread} unread`]),
    ...(paused ? ["paused"] : []),
  ].join(", ");
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
          <AnimatedBellIcon
            cue={unread === 0 ? undefined : unread}
            off={paused}
            size={15}
          />
          <CountBadge count={unread} />
        </Popover.Trigger>
      }
    />
  );
};

// Matches the theme toggle: round, borderless, in the bar's white, lit on
// hover.
const buttonStyles = css({
  _hoverOrOpen: { backgroundColor: "fillOverPhoto" },
  alignItems: "center",
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "lg",
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
