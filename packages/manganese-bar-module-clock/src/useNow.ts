import { useEffect, useRef, useState } from "react";

/** The wall clock; injectable so tests can freeze it. */
export const wallClock = (): Date => new Date();

/** A clock that shows seconds changes every second. */
export const SECOND_MS = 1000;

/** One that shows only minutes changes once a minute. */
export const MINUTE_MS = 60_000;

/**
 * The current time, re-read on each boundary of `step` while mounted and
 * `running`: every second for a clock to the second, on the minute for one to
 * the minute. Each re-read wakes the page and, if the reading changed, draws
 * a frame, so a clock ticks no faster than it changes.
 *
 * While not `running`, such as a clock on a hidden sheet, it does not tick at
 * all, and it reads the time afresh when it runs again.
 */
export const useNow = (
  now: typeof wallClock = wallClock,
  step: number = SECOND_MS,
  running = true,
): Date => {
  const [time, setTime] = useState(() => now());
  // The last reading, to time the next tick from, and whether it went stale
  // while stopped.
  const last = useRef(time);
  const stale = useRef(false);

  useEffect(() => {
    if (running) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = () => {
        last.current = now();
        setTime(last.current);
      };
      const schedule = () => {
        timer = setTimeout(
          () => {
            read();
            schedule();
          },
          step - (last.current.getTime() % step),
        );
      };
      if (stale.current) {
        stale.current = false;
        read();
      }
      schedule();
      return () => {
        clearTimeout(timer);
      };
    } else {
      stale.current = true;
      return undefined;
    }
  }, [now, step, running]);

  return time;
};
