import type { Theme } from "./theme-core";

/**
 * How a {@link ThemeProvider} reads the theme and requests changes.
 *
 * The compositor owns the theme (`theme.mode` in its config) and shares it
 * with every monitor's page and the settings portal, so the library takes it
 * through this interface.
 *
 * Keep a source stable (`useMemo` or module scope). The provider re-registers
 * whenever its identity changes.
 */
export type ThemeSource = {
  /**
   * The latest theme reported, or `undefined` before the first report.
   *
   * The page uses {@link DEFAULT_THEME} until then.
   */
  theme: Theme | undefined;
  /**
   * Registers the handler for later theme changes and returns its teardown.
   *
   * May call `handler` synchronously with the current `theme`, so the handler
   * must accept a theme it has already seen.
   */
  onTheme: (handler: (theme: Theme) => void) => () => void;
  /**
   * Requests a theme change.
   *
   * Applies nothing locally; the result arrives through `onTheme` on every
   * page.
   */
  setTheme: (theme: Theme) => void;
  /**
   * Repaints the other windows in `theme` and settles once they have.
   *
   * {@link flipThemeWithAnimation} calls this once the wipe's start frame is
   * on screen and holds the wipe at its start until it settles. Otherwise
   * windows would change before or during the wipe.
   */
  turnWindows: (theme: Theme) => Promise<void>;
};
