/**
 * A display's name and its rectangle in logical desktop coordinates.
 *
 * Declared here instead of importing the protocol's `DisplayInfo`, so this
 * package has no protocol dependency.
 */
export type Display = {
  /** Matched by `<Screen name>`. Unique across the desktop. */
  name: string;
  /** Top-left corner in logical desktop coordinates. */
  position: readonly [number, number];
  /** The scale clients on this display render at. */
  scale: number;
  /** Logical width and height. */
  size: readonly [number, number];
};

/**
 * Supplies a `DisplayProvider` with display lists, usually adapted from a
 * `DomicileClient`.
 *
 * `displays` is the latest list so far, for a provider that mounts after it
 * arrived. `onDisplays` delivers later lists. They can overlap: a
 * `DomicileClient` replays its last value to the first handler, so handlers
 * must accept a list they have already seen.
 *
 * Keep a source stable (build it once, with `useMemo` or outside the
 * component). The provider re-registers whenever its identity changes.
 */
export type DisplaySource = {
  /** The latest display list, or `undefined` before the first. */
  displays: readonly Display[] | undefined;
  /**
   * Registers the single handler for later lists and returns its teardown.
   * May call `handler` before returning.
   *
   * Over a `DomicileClient`, tear down with `off("displays", handler)`, which
   * removes the handler only if it is still registered. That way a stale
   * teardown can't remove a newer handler.
   */
  onDisplays: (handler: (displays: readonly Display[]) => void) => () => void;
};
