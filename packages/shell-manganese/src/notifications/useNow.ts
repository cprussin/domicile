import { useEffect, useState } from "react";

/** The wall clock in epoch milliseconds; injected so tests can control it. */
const wallClock = (): number => Date.now();

/**
 * How often to re-read the clock. Half a minute keeps `ago`, whose smallest
 * step is a minute, at most half a step behind.
 */
const TICK_INTERVAL_MS = 30_000;

/** The current time, refreshed every half minute, for `ago`. */
export const useNow = (clock: typeof wallClock = wallClock): number => {
  const [now, setNow] = useState(clock);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(clock());
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [clock]);

  return now;
};
