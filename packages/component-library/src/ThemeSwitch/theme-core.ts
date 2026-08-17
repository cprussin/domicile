import { flushSync } from "react-dom";

import { token } from "../../styled-system/tokens";

// The theme model and its cycle mechanics, with no React or context deps, so the
// controller (`ThemeProvider`) and the toggle (`ThemeSwitch`) can both build on
// it without importing each other.

export const THEMES = ["light", "dark"] as const;
/** The concrete theme actually applied to the page — a resolved `preference`
 *  with `system` collapsed to `light` or `dark`. */
export type ResolvedTheme = (typeof THEMES)[number];

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Cycle order used by `ThemeSwitch` clicks: light → dark → system → light. */
export const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  dark: "system",
  light: "dark",
  system: "light",
};

export type CycleThemeOptions = {
  previousResolved: ResolvedTheme;
  nextResolved: ResolvedTheme;
  /**
   * Flip the page's resolved theme. Called inside the wipe's view
   * transition update callback (or synchronously in the no-wipe branch).
   * Typically toggles a `light` class on `<html>` so design tokens
   * resolve to the new theme's values.
   */
  applyResolvedTheme: () => void;
  /**
   * Commit the new preference to React state. Called inside `flushSync`
   * after the wipe finishes (and before the rise), so that the toggle's
   * `data-theme-preference` attribute has the new value committed
   * *before* the slot override is dropped — otherwise the OLD active
   * slot would briefly retarget center before React commits the NEW
   * preference and re-parks it.
   */
  commitPreference: () => void;
};

/**
 * Run the ThemeSwitch's set → wipe → rise animation around the
 * caller's preference change. Wires `data-theme-setting` (slot
 * sequencing) and `data-theme-flipping` / `data-theme-flip-to` (page
 * wipe) on `<html>`, runs the wipe via `document.startViewTransition`
 * when the resolved theme is actually changing and the browser
 * supports it, and falls back to a snap apply otherwise. Total
 * animation: 150ms set + 500ms wipe + 200ms rise.
 */
export const cycleThemeWithAnimation = ({
  previousResolved,
  nextResolved,
  applyResolvedTheme,
  commitPreference,
}: CycleThemeOptions): void => {
  const root = document.documentElement;
  // Phase 1 (set): force every slot below the window via the
  // `data-theme-setting` descendant rule. Only the currently active
  // slot actually moves.
  root.setAttribute("data-theme-setting", "");
  window.setTimeout(() => {
    const startRise = () => {
      // flushSync so the new `data-theme-preference` attribute is
      // committed *before* the override drops — otherwise removing
      // `data-theme-setting` while preference is still OLD would let
      // the OLD active slot's target snap back to translateY(0) and
      // start rising before React commits the NEW preference.
      flushSync(() => {
        commitPreference();
      });
      root.removeAttribute("data-theme-setting");
    };
    if (
      previousResolved === nextResolved ||
      typeof document.startViewTransition !== "function"
    ) {
      applyResolvedTheme();
      startRise();
      return;
    }
    // Phase 2 (wipe). The two attributes drive the rules in the
    // pandacss preset: `data-theme-flipping` suppresses per-element
    // transitions so color changes don't bleed into the snapshots, and
    // `data-theme-flip-to` picks the wipe direction (dark = top-down,
    // light = bottom-up). Both are cleared in `finished`, immediately
    // before the rise triggers.
    root.setAttribute("data-theme-flipping", "");
    root.setAttribute("data-theme-flip-to", nextResolved);
    const transition = document.startViewTransition(() => {
      applyResolvedTheme();
    });
    const cleanup = () => {
      root.removeAttribute("data-theme-flipping");
      root.removeAttribute("data-theme-flip-to");
      startRise();
    };
    transition.finished.then(cleanup, cleanup);
  }, SET_DURATION_MS);
};

// The set phase's slot transition runs for `{durations.fast}` (see the
// `data-theme-setting` override in `slotStyles`). Source the JS timeout
// that ends the phase from the same token so the two can't drift.
const SET_DURATION_MS = Number.parseFloat(token("durations.fast"));
