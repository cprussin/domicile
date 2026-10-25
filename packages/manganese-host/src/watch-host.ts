import type { Unsubscribe } from "@domicile-desktop/sdk/desktop/subscribe";

/**
 * Watches an attribute of the desktop: calls `onValue` with `read()` now and
 * each time `subscribe` hears it change, and returns a function that stops
 * watching. For example
 * `watchHost((heard) => domicile.session.on("lockchange", heard), () => domicile.session.locked, onLocked)`.
 *
 * `read` returns `undefined` while the compositor has not said; `onValue` is
 * not called then.
 */
export const watchHost = <T>(
  subscribe: (heard: () => void) => Unsubscribe,
  read: () => T | undefined,
  onValue: (value: T) => void,
): Unsubscribe => {
  const changed = () => {
    const value = read();
    if (value !== undefined) {
      onValue(value);
    }
  };
  changed();
  return subscribe(changed);
};
