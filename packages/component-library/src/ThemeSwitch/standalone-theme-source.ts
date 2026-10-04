import type { Theme } from "./theme-core";
import { DEFAULT_THEME } from "./theme-core";
import type { ThemeSource } from "./theme-source";

/**
 * A {@link ThemeSource} for a page with no compositor, such as Storybook.
 * `setTheme` applies the theme immediately.
 *
 * `onTheme` holds one handler and replaces any earlier one.
 */
export const standaloneThemeSource = (
  initial: Theme = DEFAULT_THEME,
): ThemeSource => {
  const state = { handler: undefined as ((theme: Theme) => void) | undefined };
  const source: ThemeSource = {
    onTheme: (handler) => {
      state.handler = handler;
      return () => {
        if (state.handler === handler) {
          state.handler = undefined;
        }
      };
    },
    setTheme: (theme) => {
      source.theme = theme;
      state.handler?.(theme);
    },
    theme: initial,
    // No other windows to repaint.
    turnWindows: () => Promise.resolve(),
  };
  return source;
};
