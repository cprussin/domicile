import type { Notification } from "@domicile-desktop/sdk/notification";

/**
 * The notifications in `next` that are new since `previous`, or none when
 * `previous` is `undefined`.
 *
 * The compositor always sends the full list, so news is the difference: an
 * unseen id, or a replaced one with a new `time`. The first list is history, so
 * a reload toasts nothing.
 */
export const arrivals = (
  previous: readonly Notification[] | undefined,
  next: readonly Notification[],
): Notification[] =>
  previous === undefined
    ? []
    : next.filter(
        (notification) =>
          !previous.some(
            ({ id, time }) =>
              id === notification.id && time === notification.time,
          ),
      );
