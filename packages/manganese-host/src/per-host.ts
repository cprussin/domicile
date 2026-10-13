import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

/**
 * `make`, run once per desktop: every caller with the same `domicile` gets the
 * same value. For watches and stores that every bar, panel and the lock
 * screen share without a provider passing them down.
 */
export const perHost = <T>(
  make: (domicile: DomicileHost) => T,
): ((domicile: DomicileHost) => T) => {
  const made = new WeakMap<DomicileHost, T>();
  return (domicile) => {
    const known = made.get(domicile);
    if (known === undefined) {
      const value = make(domicile);
      made.set(domicile, value);
      return value;
    } else {
      return known;
    }
  };
};
