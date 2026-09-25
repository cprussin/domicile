import type { Theme } from "./theme-core";
import { DEFAULT_THEME } from "./theme-core";
import type { ThemeSource } from "./theme-source";

/**
 * A {@link ThemeSource} for a page with no desktop behind it: it answers its
 * own `setTheme` and nothing else is told.
 *
 * **This is the development case, not a fallback for the real one.** Storybook
 * is a page, and a shell opened in an ordinary browser for styling work is a
 * page; neither has a compositor to ask, and a toggle that did nothing in
 * either would make the component untestable by hand. Over a real desk, a
 * source built on `DomicileClient` is what a shell passes instead — there the
 * answer comes back from the compositor, because it has to reach the other
 * monitors and the desk's Wayland clients too.
 *
 * One handler, like the real thing: `onTheme` replaces whatever was registered
 * before it, so a provider that re-registers displaces rather than doubles.
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
  };
  return source;
};
