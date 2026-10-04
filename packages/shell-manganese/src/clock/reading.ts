// The clock's text.
//
// A fixed format instead of `toLocaleString`, whose length and order vary by
// locale and would shift the centered bar.

/**
 * The locale for the weekday name. Fixed to match the fixed ISO date beside
 * it.
 */
const LOCALE = "en-US";

/** The width of each zero-padded number. */
const DIGITS = 2;

/** The local date and time, as `Wednesday 2026-09-16 20:53:40`. */
export const reading = (now: Date): string =>
  `${day(now)} ${date(now)} ${time(now)}`;

const day = (now: Date): string =>
  now.toLocaleDateString(LOCALE, { weekday: "long" });

// Built from local fields, not `toISOString`, which is UTC and would show the
// wrong date near midnight.
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
