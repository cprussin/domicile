/**
 * A display the host described: where it sits on the desktop and how big it
 * is, in the desktop's own logical coordinates, which start at the origin.
 *
 * The same shape the host protocol's `DisplayInfo` carries. Declared here
 * rather than imported so this package stays framework- and protocol-free:
 * what `<Screen>` needs is a rectangle and a name, not a wire format.
 */
export type Display = {
  /** What a `<Screen name>` matches. Unique across the desktop. */
  name: string;
  /** Top-left corner, logical, in normalised desktop coordinates. */
  position: readonly [number, number];
  /** What clients on this display draw at. */
  scale: number;
  /** Logical width and height. */
  size: readonly [number, number];
};

/**
 * Where a `DisplayProvider` gets the desktop from.
 *
 * Two halves, because the host describes the desktop exactly once per
 * connection: `displays` is what it has already said — which a provider
 * mounting after the handshake would otherwise never hear — and `onDisplays`
 * for every description after that, on a reconnect or a re-describe.
 *
 * The two overlap rather than partition: `BridgeClient` replays anything it is
 * holding for a type to the first handler that registers, so an adapter over
 * one may call the handler synchronously, inside registration, with the same
 * desktop `displays` just gave. A handler has to be safe to call with a
 * description it has already seen.
 *
 * A port rather than the `BridgeClient` itself: the component library has no
 * protocol dependency, and a source is a few lines to write over one.
 *
 * **A source is the connection, so it has to be as stable as one.** The
 * provider registers on it whenever its identity changes, and `BridgeClient.on`
 * is a single slot — a source rebuilt every render would re-register on every
 * render. Build it once, with `useMemo` or outside the component.
 */
export type DisplaySource = {
  /** The desktop as described so far, or `undefined` until it has been. */
  displays: readonly Display[] | undefined;
  /**
   * Registers the one handler for further descriptions, returning the teardown
   * that stops it. A provider that unmounted while its source outlived it
   * would otherwise keep being told, and would set state on a tree that is
   * gone — the source is the connection, so it is the longer-lived of the two.
   *
   * A source over a `BridgeClient` implements the teardown with
   * `bridge.off("displays", handler)`, which removes the handler only if it is
   * still the registered one — `on` is a single slot, so a teardown that
   * removed whatever it found could silence a handler that had displaced it.
   * React does not produce that order on its own (a cleanup runs before the
   * effect that replaces it), so for the provider the teardown is simply the
   * unregistration; the handler argument is what keeps it safe for anything
   * that does not run under React's ordering.
   *
   * May call `handler` before it returns — see above.
   */
  onDisplays: (handler: (displays: readonly Display[]) => void) => () => void;
};
