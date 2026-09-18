/**
 * A display the host described: where it sits on the desktop and how big it
 * is, in the desktop's own logical coordinates, which start at the origin.
 *
 * A regrouping of what the host protocol's `DisplayInfo` carries rather than a
 * copy of it. Declared here rather than imported so this package stays
 * framework- and protocol-free: what `<Screen>` needs is a rectangle, a name,
 * and — where the page's window is one monitor — what covering that window
 * takes.
 */
export type Display = {
  /** What a `<Screen name>` matches. Unique across the desktop. */
  name: string;
  /** Top-left corner, logical, in normalized desktop coordinates. */
  position: readonly [number, number];
  /** What clients on this display draw at. */
  scale: number;
  /** Logical width and height. */
  size: readonly [number, number];
  /**
   * The pixels the monitor scans out, un-turned, where its window is this
   * monitor. `undefined` everywhere else, which is every desktop the page's
   * window is the whole of.
   *
   * **Its presence is the claim, which is why it is one field rather than
   * three.** A window that IS a monitor has to draw its logical box over the
   * whole of itself, turned by `transform` and scaled by however many of these
   * pixels a logical one is worth; a page that is the desktop has nothing to
   * map and gets nothing to map it with. A `size` and a `transform` sitting
   * there unconditionally would be description, and a region would have to be
   * told separately whether to believe them.
   *
   * Not a second spelling of `size`: a monitor on its side scans out exactly
   * as it did lying down, so a portrait 4K panel is a 3840×2160 mode and an
   * 1800×3200 box.
   */
  scanout?: Scanout | undefined;
};

/**
 * What a display's window is, for a region that has to cover it.
 *
 * @see Display.scanout
 */
export type Scanout = {
  /** The window's size in CSS pixels: the monitor's mode, un-turned. */
  size: readonly [number, number];
  /**
   * Which way up the monitor is, as the turn the content takes to come out
   * upright — the `wl_output` convention. Applied as written.
   */
  transform: Transform;
};

/**
 * The four rotations a monitor can be bolted to a desk at, spelled the way the
 * host and the config file spell them.
 *
 * Its own list rather than `@domicile/chrome-sdk`'s, because this package has
 * no protocol dependency — the same reason {@link Display} is declared here
 * rather than imported. It is not a fifth list to keep honest by hand:
 * `scripts/test-display-transforms-agree.sh` compares the ones that cross
 * process boundaries, and the adapter that fills a {@link Scanout} assigns the
 * SDK's type to this one, so a disagreement between the two is a type error at
 * that seam rather than a monitor drawn the wrong way.
 */
export type Transform = "normal" | "rotate-90" | "rotate-180" | "rotate-270";

/**
 * Where a `DisplayProvider` gets the desktop from.
 *
 * Two halves, because a provider does not necessarily mount in time to hear
 * the description it needs: `displays` is what the host has already said, and
 * `onDisplays` is every description after that — the desktop is described on
 * connecting and again whenever it changes, latest wins.
 *
 * The two overlap rather than partition: `DomicileClient` replays anything it
 * is holding for a type to the first handler that registers, so an adapter over
 * one may call the handler synchronously, inside registration, with the same
 * desktop `displays` just gave. A handler has to be safe to call with a
 * description it has already seen.
 *
 * A port rather than the `DomicileClient` itself: the component library has no
 * protocol dependency, and a source is a few lines to write over one.
 *
 * **A source is the connection, so it has to be as stable as one.** The
 * provider registers on it whenever its identity changes, and
 * `DomicileClient.on` is a single slot — a source rebuilt every render would re-register on every
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
   * A source over a `DomicileClient` implements the teardown with
   * `off("displays", handler)` on it, which removes the handler only if it is
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
