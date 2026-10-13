import { useEffect, useState } from "react";

/** The wall clock; injectable so tests can freeze it. */
export const wallClock = (): Date => new Date();

/** The clock shows seconds, so it updates every second. */
const TICK_INTERVAL_MS = 1000;

/** The current time, updated every second while mounted. */
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
