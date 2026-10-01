/** The locale an old notification's date is written in; see `clock/reading.ts`. */
const LOCALE = "en-US";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * How long ago `time` was at `now`, both milliseconds since the epoch, as a
 * notification's corner says it: `now`, `5m`, `3h`, `2d`, then the date.
 *
 * Short, because it is beside the sender's name on one line, and a time past
 * now — a sender's clock a little ahead of this page's — is now.
 */
export const ago = (time: number, now: number): string => {
  const since = now - time;
  if (since < MINUTE_MS) {
    return "now";
  } else if (since < HOUR_MS) {
    return `${Math.floor(since / MINUTE_MS)}m`;
  } else if (since < DAY_MS) {
    return `${Math.floor(since / HOUR_MS)}h`;
  } else if (since < WEEK_MS) {
    return `${Math.floor(since / DAY_MS)}d`;
  } else {
    return new Date(time).toLocaleDateString(LOCALE, {
      day: "numeric",
      month: "short",
    });
  }
};
