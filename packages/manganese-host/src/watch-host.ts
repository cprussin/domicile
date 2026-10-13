import type {
  DomicileHost,
  DomicileHostEventMap,
} from "@domicile-desktop/sdk/domicile-host";

/** The bare events that say an attribute of the desktop changed. */
export type HostChange = {
  [T in keyof DomicileHostEventMap]: DomicileHostEventMap[T] extends Event
    ? Event extends DomicileHostEventMap[T]
      ? T
      : never
    : never;
}[keyof DomicileHostEventMap];

/**
 * Watches an attribute: calls `onValue` with `read(domicile)` now and on every
 * `change`, and returns a function that stops watching.
 *
 * `read` returns `undefined` while the attribute is `null`; `onValue` is not
 * called then.
 */
export const watchHost = <T>(
  domicile: DomicileHost,
  change: HostChange,
  read: (domicile: DomicileHost) => T | undefined,
  onValue: (value: T) => void,
): (() => void) => {
  const changed = () => {
    const value = read(domicile);
    if (value !== undefined) {
      onValue(value);
    }
  };
  changed();
  domicile.addEventListener(change, changed);
  return () => {
    domicile.removeEventListener(change, changed);
  };
};
