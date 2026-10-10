import { flushSync } from "react-dom";

import { token } from "../../styled-system/tokens";

// The theme model and flip animation, free of React context so `ThemeProvider`
// and `ThemeSwitch` can share it without importing each other.

export const THEMES = ["dark", "light"] as const;

/**
 * The color theme of the page.
 *
 * There is no `system` value: Domicile is the system, so
 * `prefers-color-scheme` only reflects this setting. The current value comes
 * from a {@link ThemeSource}.
 */
export type Theme = (typeof THEMES)[number];

/**
 * The theme a page paints in before its source reports one.
 *
 * Matches the default of `theme.mode` in the compositor config, and the
 * preset's attribute-less `<html>` state.
 */
export const DEFAULT_THEME: Theme = "dark";

/** What the preset's `_light` condition selects on. */
const THEME_ATTRIBUTE = "data-theme";

/** What the preset pauses the wipe on while windows turn. */
const HOLDING_ATTRIBUTE = "data-theme-holding";

/**
 * Applies a theme to `<html>` so the tokens resolve to it.
 *
 * Dark removes the attribute because the preset only matches
 * `[data-theme=light]`. Safe to call before React mounts, so a shell's first
 * paint can use the right theme.
 */
export const applyTheme = (theme: Theme): void => {
  const root = globalThis.document?.documentElement;
  if (theme === "light") {
    root?.setAttribute(THEME_ATTRIBUTE, "light");
  } else {
    root?.removeAttribute(THEME_ATTRIBUTE);
  }
};

/** The opposite of each theme. */
export const OTHER_THEME: Record<Theme, Theme> = {
  dark: "light",
  light: "dark",
};

export type FlipThemeOptions = {
  previous: Theme;
  next: Theme;
  /**
   * Applies the new theme to the page, normally with {@link applyTheme}.
   * Called inside the view transition update, or synchronously without one.
   */
  applyNextTheme: () => void;
  /**
   * Repaints the other windows once the wipe's start frame is on screen. See
   * {@link ThemeSource.turnWindows}.
   */
  turnWindows: () => Promise<void>;
  /**
   * Commits the new theme to React state. Called in `flushSync` after the
   * wipe, so `data-theme-mode` updates before the slot override is removed.
   * Otherwise the old icon would briefly rise.
   */
  commitTheme: () => void;
};

/**
 * Runs the set, wipe and rise animation around a theme change.
 *
 * Uses `document.startViewTransition` for the wipe when available and applies
 * the theme instantly otherwise. Call it when a new theme arrives from the
 * source, not on click: the change may come from a config edit or another
 * monitor.
 */
export const flipThemeWithAnimation = ({
  previous,
  next,
  applyNextTheme,
  commitTheme,
  turnWindows,
}: FlipThemeOptions): void => {
  const root = document.documentElement;
  // Set: move both icons below the window.
  root.setAttribute("data-theme-setting", "");
  window.setTimeout(() => {
    const startRise = () => {
      // Commit `data-theme-mode` before removing the override, or the old
      // icon would start rising.
      flushSync(() => {
        commitTheme();
      });
      root.removeAttribute("data-theme-setting");
    };
    if (
      previous === next ||
      typeof document.startViewTransition !== "function"
    ) {
      // No wipe: apply the theme between set and rise.
      applyNextTheme();
      turnWindows().catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a failed turnover
        console.error("Failed to turn the desk's windows", error);
      });
      startRise();
    } else {
      // Wipe. In the preset, `data-theme-flipping` disables element
      // transitions so they don't leak into the snapshots, and
      // `data-theme-flip-to` sets the wipe direction.
      root.setAttribute("data-theme-flipping", "");
      root.setAttribute("data-theme-flip-to", next);
      // `data-theme-holding` pauses the wipe at its start, so only the old
      // frame shows.
      root.setAttribute(HOLDING_ATTRIBUTE, "");
      const transition = document.startViewTransition(applyNextTheme);
      // Turn the windows once the old frame is on screen. Until `ready`, the
      // screen shows the page's live frame, with `<app>` windows in it, and
      // the update callback runs before the capture has been drawn.
      const turnWindowsBehindWipe = () =>
        turnWindows().finally(() => {
          root.removeAttribute(HOLDING_ATTRIBUTE);
        });
      transition.ready
        .then(turnWindowsBehindWipe, turnWindowsBehindWipe)
        .catch((error: unknown) => {
          // biome-ignore lint/suspicious/noConsole: surfacing a failed turnover
          console.error("Failed to turn the desk's windows", error);
        });
      const cleanup = () => {
        root.removeAttribute("data-theme-flipping");
        root.removeAttribute("data-theme-flip-to");
        startRise();
      };
      transition.finished.then(cleanup, cleanup);
    }
  }, SET_DURATION_MS);
};

// Matches the set transition in `slotStyles` so the two can't drift.
const SET_DURATION_MS = Number.parseFloat(token("durations.fast"));
