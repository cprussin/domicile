/** One watch that many components read, for `useSyncExternalStore`. */
export type SharedWatch<T> = {
  /** Starts the watch for the first subscriber and stops it after the last. */
  subscribe: (onChange: () => void) => () => void;
  /** The latest value, or `undefined` before the first and while stopped. */
  current: () => T | undefined;
};

/**
 * Shares the watch `start` begins among every subscriber, so a library's
 * watch runs once however many bars show it.
 *
 * `start` calls `onValue` with each value and returns what stops it. Failures
 * stay `start`'s to handle, as values or logs.
 */
export const sharedWatch = <T>(
  start: (onValue: (value: T) => void) => () => void,
): SharedWatch<T> => {
  const listeners = new Set<() => void>();
  const state: { running: Running<T> | undefined } = { running: undefined };
  return {
    current: () => state.running?.value,
    subscribe: (onChange) => {
      listeners.add(onChange);
      if (state.running === undefined) {
        state.running = run(start, listeners);
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          state.running?.stop();
          state.running = undefined;
        }
      };
    },
  };
};

/**
 * One run of the watch. Each run holds its own value, so one a stopped run
 * sends late is never read.
 */
type Running<T> = { value: T | undefined; stop: () => void };

const run = <T>(
  start: (onValue: (value: T) => void) => () => void,
  listeners: ReadonlySet<() => void>,
): Running<T> => {
  const running: { value: T | undefined } = { value: undefined };
  const stop = start((value) => {
    running.value = value;
    for (const onChange of listeners) {
      onChange();
    }
  });
  return Object.assign(running, { stop });
};
