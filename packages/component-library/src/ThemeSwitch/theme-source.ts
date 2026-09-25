import type { Theme } from "./theme-core";

/**
 * Where a {@link ThemeProvider} gets the theme from, and what it asks when the
 * toggle is clicked.
 *
 * **The theme is not this package's to own, and that is the whole shape of
 * this type.** A Domicile shell is the desktop's chrome, so the theme it
 * paints in is the *desktop's*: it comes out of `[theme] mode` in the
 * compositor's config, it is the same value the compositor hands the settings
 * portal that GTK, Qt and Electron read, and a desk of three monitors is three
 * pages that have to move together. None of that is knowable from inside a
 * component library, so the library is handed a port instead.
 *
 * Three members, and the first two are {@link DisplaySource}'s for
 * {@link DisplaySource}'s reason: a provider does not necessarily mount in
 * time to hear the message it needs, so `theme` is what the host has already
 * said and `onTheme` is everything after that. They overlap rather than
 * partition — an adapter over a `DomicileClient` may call the handler
 * synchronously, inside registration, with the same theme `theme` just gave —
 * so a handler has to be safe to call with a theme it has already seen.
 *
 * `setTheme` is the third, and it is a *request*. Nothing is applied where it
 * is called: what follows is an `onTheme` carrying the answer, to this page
 * and to every other page on the desk. A source that applied it locally would
 * be the one monitor that had changed.
 *
 * **A source is the connection, so it has to be as stable as one.** The
 * provider registers on it whenever its identity changes, and
 * `DomicileClient.on` is a single slot — a source rebuilt every render would
 * re-register every render. Build it once, with `useMemo` or outside the
 * component.
 */
export type ThemeSource = {
  /**
   * The theme as the desk has stated it so far, or `undefined` until it has.
   *
   * `undefined` is a page that has not been told rather than a page with no
   * theme: {@link DEFAULT_THEME} is what it paints in meanwhile, and being
   * told is what animates.
   */
  theme: Theme | undefined;
  /**
   * Registers the one handler for what the desk says next, returning the
   * teardown that stops it. May call `handler` before it returns — see above.
   */
  onTheme: (handler: (theme: Theme) => void) => () => void;
  /**
   * Ask the desk to draw itself the other way round.
   *
   * A request rather than a setter: what comes back is an `onTheme`.
   */
  setTheme: (theme: Theme) => void;
  /**
   * This page has captured the frame its wipe starts from, for `theme`: turn
   * the desk's windows, and settle once they have repainted.
   *
   * The windows are in that frame, so a window turned before it was captured
   * is wiped over already turned, and one turned after the wipe starts pops
   * over mid-wipe. {@link flipThemeWithAnimation} calls this from inside the
   * wipe's update and holds the old frame until it settles, so the wipe
   * passes across windows that turned behind it.
   */
  turnWindows: (theme: Theme) => Promise<void>;
};
