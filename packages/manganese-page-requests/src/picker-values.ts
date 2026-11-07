/**
 * The HTML value formats a page's date, time and color inputs use, and the
 * calendar arithmetic the shell's pickers need. Dates are plain
 * `{ year, month, day }` with `month` 1–12, never `Date`, so no time zone can
 * move a day.
 */

export type Day = { year: number; month: number; day: number };
export type Time = { hour: number; minute: number };

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

const DATE = /^(\d{4,})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4,})-(\d{2})$/;
const WEEK = /^(\d{4,})-W(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const HEX = /^#([0-9a-f]{6})$/i;

/** Days in `month` of `year`. */
export const daysIn = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `"2026-11-06"` as a day, or `undefined` for anything else. */
export const parseDate = (value: string): Day | undefined => {
  const match = DATE.exec(value);
  if (match === null) {
    return undefined;
  } else {
    const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [
      number,
      number,
      number,
    ];
    return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month)
      ? { day, month, year }
      : undefined;
  }
};

export const formatDate = ({ year, month, day }: Day): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** `"2026-11"` as the month's first day, or `undefined`. */
export const parseMonth = (value: string): Day | undefined => {
  const match = MONTH.exec(value);
  const month = Number(match?.[2]);
  return match === null || month < 1 || month > 12
    ? undefined
    : { day: 1, month, year: Number(match[1]) };
};

export const formatMonth = ({ year, month }: Day): string =>
  `${pad(year, 4)}-${pad(month)}`;

/** `"13:45"` (seconds ignored), or `undefined`. */
export const parseTime = (value: string): Time | undefined => {
  const match = TIME.exec(value);
  const [hour, minute] = [Number(match?.[1]), Number(match?.[2])];
  return match === null || hour > 23 || minute > 59
    ? undefined
    : { hour, minute };
};

export const formatTime = ({ hour, minute }: Time): string =>
  `${pad(hour)}:${pad(minute)}`;

/** `"2026-11-06T13:45"` as its day and time, or `undefined`. */
export const parseDateTime = (
  value: string,
): { day: Day; time: Time } | undefined => {
  const [date = "", time = ""] = value.split("T");
  const day = parseDate(date);
  const clock = parseTime(time);
  return day === undefined || clock === undefined
    ? undefined
    : { day, time: clock };
};

export const formatDateTime = (day: Day, time: Time): string =>
  `${formatDate(day)}T${formatTime(time)}`;

/** Days since 1970-01-01, for comparing and stepping. */
const ordinal = ({ year, month, day }: Day): number =>
  Date.UTC(year, month - 1, day) / 86_400_000;

const fromOrdinal = (days: number): Day => {
  const date = new Date(days * 86_400_000);
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
};

/** `day` moved by `days`. */
export const addDays = (day: Day, days: number): Day =>
  fromOrdinal(ordinal(day) + days);

/** Monday 1 … Sunday 7, as ISO 8601 numbers them. */
const isoWeekday = (day: Day): number => {
  const weekday = new Date(ordinal(day) * 86_400_000).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

/** The ISO 8601 week `day` falls in, which may belong to a nearby year. */
export const weekOf = (day: Day): { year: number; week: number } => {
  // The week's Thursday decides its year.
  const thursday = addDays(day, 4 - isoWeekday(day));
  const first = { day: 1, month: 1, year: thursday.year };
  return {
    week: Math.floor((ordinal(thursday) - ordinal(first)) / 7) + 1,
    year: thursday.year,
  };
};

/** `"2026-W45"` as its Monday, or `undefined`. */
export const parseWeek = (value: string): Day | undefined => {
  const match = WEEK.exec(value);
  if (match === null) {
    return undefined;
  } else {
    const [year, week] = [Number(match[1]), Number(match[2])];
    // January 4th is always in week 1.
    const fourth = { day: 4, month: 1, year };
    const monday = addDays(fourth, 1 - isoWeekday(fourth) + (week - 1) * 7);
    return week >= 1 && weekOf(monday).week === week ? monday : undefined;
  }
};

export const formatWeek = (day: Day): string => {
  const { year, week } = weekOf(day);
  return `${pad(year, 4)}-W${pad(week)}`;
};

/**
 * The weeks of `month` for a calendar, Sunday first, each seven days; days of
 * the months around it fill the first and last weeks.
 */
export const calendarOf = (year: number, month: number): Day[][] => {
  const first = { day: 1, month, year };
  const start = addDays(first, -(isoWeekday(first) % 7));
  const weeks: Day[][] = [];
  for (
    let day = start;
    weeks.length === 0 || day.month === month;
    day = addDays(day, 7)
  ) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(day, index)));
  }
  return weeks;
};

/** Whether `a` is before `b`, after it, or the same day: -1, 1 or 0. */
export const compareDays = (a: Day, b: Day): number =>
  Math.sign(ordinal(a) - ordinal(b));

/** Whether `day` is within the bounds, either of which may be missing. */
export const isWithin = (
  day: Day,
  min: Day | undefined,
  max: Day | undefined,
): boolean =>
  (min === undefined || compareDays(day, min) >= 0) &&
  (max === undefined || compareDays(day, max) <= 0);

/** `"#1971c2"`, lowercased, or `undefined` for anything else. */
export const parseHex = (value: string): string | undefined => {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX.test(withHash) ? withHash.toLowerCase() : undefined;
};

export type Hsv = { hue: number; saturation: number; value: number };

/** The hue sextant, 0–6, of a color whose largest channel is `max`. */
const hueOf = (
  r: number,
  g: number,
  b: number,
  max: number,
  range: number,
): number => {
  if (range === 0) {
    return 0;
  } else if (max === r) {
    return ((g - b) / range + 6) % 6;
  } else if (max === g) {
    return (b - r) / range + 2;
  } else {
    return (r - g) / range + 4;
  }
};

/** A `"#rrggbb"` color as hue 0–360 and saturation and value 0–1. */
export const hexToHsv = (hex: string): Hsv => {
  const [r, g, b] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  const hue = hueOf(r, g, b, max, range);
  return {
    hue: hue * 60,
    saturation: max === 0 ? 0 : range / max,
    value: max,
  };
};

export const hsvToHex = ({ hue, saturation, value }: Hsv): string => {
  const channel = (n: number) => {
    const k = (n + hue / 60) % 6;
    const level =
      value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(level * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
};
