import { useEffect, useState } from "react";

/** The wall clock, in milliseconds since the epoch; injected so tests can hold it. */
const wallClock = (): number => Date.now();

/**
 * How often "5m ago" is read again. Half a minute, so a reading is never more
 * than half a step behind — the smallest step `ago` says is a minute.
 */
const TICK_INTERVAL_MS = 30_000;

/** The time now, read again every half minute, for `ago` to measure from. */
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
