import type { Notification } from "@domicile/sdk/notification";

/** How long a toast stays up when its sender left it to the desk. */
const LEFT_TO_THE_DESK_MS = { low: 4000, normal: 6000 } as const;

/** Shorter than this is gone before it is read. */
const SHORTEST_MS = 2000;

/** Longer than this is a window nobody opened. */
const LONGEST_MS = 30_000;

/**
 * How long `notification`'s toast stays up, in milliseconds: `0` for until it
 * is dismissed.
 *
 * Only the toast: a notification stays in the drawer until it is cleared, so
 * this is how long it interrupts rather than how long it lives. A critical one
 * interrupts until somebody answers it, whatever its sender asked.
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
