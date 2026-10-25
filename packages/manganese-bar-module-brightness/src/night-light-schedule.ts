// When the night light is on: from sunset to sunrise, or between two times of
// day, easing in and out over half an hour as macOS does.

import type { Place } from "./sun-times";
import { sunTimes } from "./sun-times";

/** Two times of day, in minutes after midnight. `to` before `from` is the next day. */
export type Hours = { readonly from: number; readonly to: number };

export enum ScheduleKind {
  Sun,
  Hours,
}

export const Schedule = {
  /** Between two times of day. */
  Hours: (hours: Hours) => ({ hours, kind: ScheduleKind.Hours as const }),
  /**
   * From sunset to sunrise at `place`, or between `hours` on a day the sun
   * neither rises nor sets.
   */
  Sun: (place: Place, hours: Hours) => ({
    hours,
    kind: ScheduleKind.Sun as const,
    place,
  }),
};

export type Schedule = ReturnType<(typeof Schedule)[keyof typeof Schedule]>;

/** One night: when the light starts to warm, and when it is back to neutral. */
export type Night = { readonly start: Date; readonly end: Date };

/** How long the light takes to warm, and to cool again. */
const EASE_MS = 30 * 60_000;

/** The nights that begin yesterday, today and tomorrow, in local time. */
export const nightsAround = (now: Date, schedule: Schedule): Night[] =>
  [-1, 0, 1].map((offset) =>
    nightOf(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      schedule,
    ),
  );

/**
 * How warm the light is at `now` during `nights`, from 0 (neutral) to 1: it
 * warms over half an hour from the start and cools over the half hour before
 * the end.
 */
export const strengthAt = (now: Date, nights: readonly Night[]): number =>
  Math.max(
    0,
    ...nights.map(({ end, start }) =>
      now >= start && now < end
        ? Math.min(
            1,
            (now.getTime() - start.getTime()) / EASE_MS,
            (end.getTime() - now.getTime()) / EASE_MS,
          )
        : 0,
    ),
  );

/** The end of the night `now` is in, or of the next one. */
export const nightEnd = (
  now: Date,
  nights: readonly Night[],
): Date | undefined => nights.find(({ end }) => end > now)?.end;

const nightOf = (
  year: number,
  month: number,
  day: number,
  schedule: Schedule,
): Night => {
  switch (schedule.kind) {
    case ScheduleKind.Sun: {
      // A `Date` normalizes the day after the end of a month.
      const next = new Date(year, month, day + 1);
      const today = sunTimes(year, month, day, schedule.place);
      const tomorrow = sunTimes(
        next.getFullYear(),
        next.getMonth(),
        next.getDate(),
        schedule.place,
      );
      return today.zip(tomorrow).match({
        None: () => hoursNight(year, month, day, schedule.hours),
        Some: ([{ sunset }, { sunrise }]) => ({ end: sunrise, start: sunset }),
      });
    }
    case ScheduleKind.Hours: {
      return hoursNight(year, month, day, schedule.hours);
    }
  }
};

const hoursNight = (
  year: number,
  month: number,
  day: number,
  { from, to }: Hours,
): Night => ({
  end: new Date(year, month, day + (to <= from ? 1 : 0), 0, to),
  start: new Date(year, month, day, 0, from),
});
