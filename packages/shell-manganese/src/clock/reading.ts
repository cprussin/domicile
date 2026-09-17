// What the clock says, as one string.
//
// Its own module because it is the one part of a clock that can be asserted on
// without a render, and because the format is a decision rather than a default:
// `toLocaleString` gives a locale's idea of a date, which is a different number
// of characters every hour and a different order in every locale — not
// something to put in the middle of a bar and expect to stay put.

/**
 * The locale the day is named in.
 *
 * Fixed rather than the desktop's, because the rest of the reading is not a
 * locale's format either: an ISO date beside a day named in whatever language
 * the machine happens to be set to is neither one convention nor the other.
 */
const LOCALE = "en-US";

/** How wide every number in the reading is written. */
const DIGITS = 2;

/** The local date and time, as `Wednesday 2026-09-16 20:53:40`. */
export const reading = (now: Date): string =>
  `${day(now)} ${date(now)} ${time(now)}`;

const day = (now: Date): string =>
  now.toLocaleDateString(LOCALE, { weekday: "long" });

// Built out of the local fields rather than out of `toISOString`, which is UTC:
// a desktop in London reads yesterday's date for the first hour of every
// summer morning.
const date = (now: Date): string =>
  [
    now.getFullYear().toString(),
    padded(now.getMonth() + 1),
    padded(now.getDate()),
  ].join("-");

const time = (now: Date): string =>
  [
    padded(now.getHours()),
    padded(now.getMinutes()),
    padded(now.getSeconds()),
  ].join(":");

const padded = (value: number): string =>
  value.toString().padStart(DIGITS, "0");
