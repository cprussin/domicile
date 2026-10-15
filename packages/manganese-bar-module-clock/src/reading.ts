// The clock's text.
//
// A fixed format instead of `toLocaleString`, whose length and order vary by
// locale and would shift the centered bar.

import type { ClockOptions } from "./clock-options";

/**
 * The locale for the weekday name. Fixed to match the fixed ISO date beside
 * it.
 */
const LOCALE = "en-US";

/** The width of each zero-padded number. */
const DIGITS = 2;

/** The hours on a 12-hour clock. */
const HALF_DAY = 12;

/**
 * The local date and time, as `Wednesday 2026-09-16 20:53:40`, or
 * `Wednesday 2026-09-16 08:53 PM` on a 12-hour clock without seconds.
 */
export const reading = (now: Date, options: ClockOptions): string =>
  `${day(now)} ${date(now)} ${time(now, options)}`;

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

// Every field padded, so the text keeps its width as the time changes.
const time = (now: Date, { format, seconds }: ClockOptions): string => {
  const fields = [
    padded(
      format === "24h" ? now.getHours() : now.getHours() % HALF_DAY || HALF_DAY,
    ),
    padded(now.getMinutes()),
    ...(seconds ? [padded(now.getSeconds())] : []),
  ].join(":");
  return format === "24h"
    ? fields
    : `${fields} ${now.getHours() < HALF_DAY ? "AM" : "PM"}`;
};

const padded = (value: number): string =>
  value.toString().padStart(DIGITS, "0");
