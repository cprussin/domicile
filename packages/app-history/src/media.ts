// The page follows the desktop's theme and motion setting through media
// queries: Domicile sets `prefers-color-scheme` from its theme, and the page
// has no `DomicileHost` to read it from.

import type { Theme } from "@domicile-desktop/component-library/theme-core";
import type { ThemeSource } from "@domicile-desktop/component-library/theme-source";

/** The parts of a `MediaQueryList` the page reads. */
export type MediaQuery = {
  addEventListener: (
    type: "change",
    listener: (event: { matches: boolean }) => void,
  ) => void;
  matches: boolean;
  removeEventListener: (
    type: "change",
    listener: (event: { matches: boolean }) => void,
  ) => void;
};

/** A theme source over a `(prefers-color-scheme: light)` query. */
export const mediaThemeSource = (
  light: MediaQuery = matchMedia("(prefers-color-scheme: light)"),
): ThemeSource => ({
  onTheme: (handler) => {
    const changed = (event: { matches: boolean }) => {
      handler(themeOf(event.matches));
    };
    light.addEventListener("change", changed);
    return () => {
      light.removeEventListener("change", changed);
    };
  },
  setTheme: () => {
    throw new Error("The desktop's theme is set by the desktop");
  },
  theme: themeOf(light.matches),
  // No other windows belong to this page.
  turnWindows: () => Promise.resolve(),
});

/**
 * Sets `data-reduced-motion` on `root` while `reduce` matches, which the
 * preset reads to shorten every animation. Returns a function that stops.
 */
export const followReducedMotion = (
  reduce: MediaQuery = matchMedia("(prefers-reduced-motion: reduce)"),
  root: HTMLElement = document.documentElement,
): (() => void) => {
  const changed = (event: { matches: boolean }) => {
    root.toggleAttribute("data-reduced-motion", event.matches);
  };
  changed(reduce);
  reduce.addEventListener("change", changed);
  return () => {
    reduce.removeEventListener("change", changed);
  };
};

const themeOf = (light: boolean): Theme => (light ? "light" : "dark");
