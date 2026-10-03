import type { Notification } from "@domicile-desktop/sdk/notification";

/**
 * Which of `next` just happened, given the list the page had been told before
 * it, `previous` — `undefined` for none yet.
 *
 * The compositor sends every notification every time, so news is a difference:
 * an id the page had not been told, or one whose sender replaced it, which
 * moves its `time`. The first list a page is told is the desk's history, so
 * none of it is news — a page that reloaded must not toast everything again.
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
