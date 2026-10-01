import { useEffect, useState } from "react";

/** The wall clock; injected so tests can hold it still. */
export const wallClock = (): Date => new Date();

/** A reading is good for a second, so the clock is read every second. */
const TICK_INTERVAL_MS = 1000;

/** The time, read again every second for as long as the caller is mounted. */
export const useNow = (now: typeof wallClock = wallClock): Date => {
  const [time, setTime] = useState(() => now());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(now());
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [now]);

  return time;
};
