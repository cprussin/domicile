import type { Notification } from "@domicile-desktop/sdk/notification";

/** How long a toast stays up when the sender does not specify. */
const LEFT_TO_THE_DESK_MS = { low: 4000, normal: 6000 } as const;

/** The shortest toast timeout, so it can be read. */
const SHORTEST_MS = 2000;

/** The longest toast timeout, so it does not linger. */
const LONGEST_MS = 30_000;

/**
 * How long `notification`'s toast stays up, in milliseconds; `0` means until
 * dismissed.
 *
 * This only limits the toast; the notification stays in the drawer. Critical
 * notifications stay up until answered, whatever the sender asked.
 */
export const toastTimeout = (notification: Notification): number => {
  if (notification.urgency === "critical" || notification.timeoutMs === 0) {
    return 0;
  } else if (notification.timeoutMs === undefined) {
    return LEFT_TO_THE_DESK_MS[notification.urgency];
  } else {
    return Math.min(Math.max(notification.timeoutMs, SHORTEST_MS), LONGEST_MS);
  }
};
