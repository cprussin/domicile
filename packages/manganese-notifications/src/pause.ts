import type { Pause } from "./stored-pause";

/** How long a pause lasts, as picked from the drawer's Pause menu. */
export enum PauseLength {
  Hour,
  Tomorrow,
  UntilResumed,
}

const HOUR_MS = 3_600_000;

/** The hour of the morning a pause until tomorrow ends. */
const MORNING_HOUR = 8;

/**
 * When a pause of `length` started at `now` ends, in ms since the epoch, or
 * `undefined` for one that lasts until resumed.
 */
export const pauseEnd = (
  length: PauseLength,
  now: number,
): number | undefined => {
  switch (length) {
    case PauseLength.Hour: {
      return now + HOUR_MS;
    }
    case PauseLength.Tomorrow: {
      return nextMorning(new Date(now)).getTime();
    }
    case PauseLength.UntilResumed: {
      return undefined;
    }
  }
};

/** What the drawer says under its title while `pause` holds at `now`. */
export const pausedFor = ({ until }: Pause, now: number): string =>
  until === undefined ? "Paused" : `Paused until ${endsAt(until, now)}`;

/** 8 AM the day after `now`'s date, local time. */
const nextMorning = (now: Date): Date =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, MORNING_HOUR);

/** `until`'s time, after "tomorrow" when that is not `now`'s date. */
const endsAt = (until: number, now: number): string => {
  const end = new Date(until);
  const time = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return end.toDateString() === new Date(now).toDateString()
    ? time
    : `tomorrow, ${time}`;
};
