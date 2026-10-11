import { useEffect, useState } from "react";

/**
 * Milliseconds since the page started, on a clock that only goes forward.
 * The wait is counted on it, so setting the wall clock cannot lengthen or skip
 * it. Injectable so tests can freeze it.
 */
export const uptime = (): number => performance.now();

/** The wait shows whole seconds, so it updates every second. */
const TICK_INTERVAL_MS = 1000;

/** {@link uptime}, updated every second while mounted. */
export const useUptime = (clock: typeof uptime = uptime): number => {
  const [time, setTime] = useState(clock);

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(clock());
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [clock]);

  return time;
};
