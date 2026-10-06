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
 * Supplies a `DisplayProvider` with display lists, usually adapted from
 * the desktop a shell is handed.
 *
 * `displays` is the latest list so far, for a provider that mounts after it
 * arrived. `onDisplays` delivers later lists. They can overlap: an adapter may
 * call the handler with the current list as it registers, so handlers must
 * accept a list they have already seen.
 *
 * Keep a source stable (build it once, with `useMemo` or outside the
 * component). The provider re-registers whenever its identity changes.
 */
export type DisplaySource = {
  /** The latest display list, or `undefined` before the first. */
  displays: readonly Display[] | undefined;
  /**
   * Registers a handler for later lists and returns its teardown. May call
   * `handler` before returning.
   */
  onDisplays: (handler: (displays: readonly Display[]) => void) => () => void;
};
