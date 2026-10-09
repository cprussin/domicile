// Days and times as the history list shows them, in the viewer's time zone.

/** A day header's text: "Today" or "Yesterday" where it applies, and the date. */
export type DayLabel = {
  relative: "Today" | "Yesterday" | undefined;
  date: string;
};

/** Local midnight of the day `time` falls on. */
export const startOfDay = (time: number): number => {
  const date = new Date(time);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
};

/**
 * The header for the day starting at `day`, as seen at `now`.
 *
 * `locale` is the page's language unless a test pins one.
 */
export const dayLabel = (
  day: number,
  now: number,
  locale?: string,
): DayLabel => ({
  date: new Date(day).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }),
  relative: relativeDay(day, startOfDay(now)),
});

/** A visit's time, such as "3:42 PM". */
export const timeOfDay = (time: number, locale?: string): string =>
  new Date(time).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });

const relativeDay = (day: number, today: number): DayLabel["relative"] => {
  if (day === today) {
    return "Today";
  } else if (day === previousDay(today)) {
    return "Yesterday";
  } else {
    return undefined;
  }
};

/** The midnight before `day`'s, which is not always 24 hours earlier. */
const previousDay = (day: number): number => {
  const date = new Date(day);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - 1,
  ).getTime();
};
