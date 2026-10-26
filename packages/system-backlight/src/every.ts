/** Calls `tick` every `ms` until the returned function stops it. */
export type Every = (ms: number, tick: () => void) => () => void;

/** {@link Every} on `setInterval`. */
export const everyInterval: Every = (ms, tick) => {
  const interval = setInterval(tick, ms);
  return () => {
    clearInterval(interval);
  };
};
