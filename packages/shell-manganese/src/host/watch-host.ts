import type {
  DomicileHost,
  DomicileHostEventMap,
} from "@domicile-desktop/sdk/domicile-host";

/** The bare events that say an attribute of the desktop moved. */
export type HostChange = {
  [T in keyof DomicileHostEventMap]: DomicileHostEventMap[T] extends Event
    ? Event extends DomicileHostEventMap[T]
      ? T
      : never
    : never;
}[keyof DomicileHostEventMap];

/**
 * Watch something the host holds: `onValue` is called with `read(domicile)`
 * now, if the host has said it, and again on every `change` — and what comes
 * back stops it.
 *
 * `read` answers `undefined` for what the host has not said yet, which is the
 * engine's `null` and nothing to tell.
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
