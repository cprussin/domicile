import { flushSync } from "react-dom";

import { token } from "../../styled-system/tokens";

// The theme model and its flip mechanics, with no React or context deps, so the
// controller (`ThemeProvider`) and the toggle (`ThemeSwitch`) can both build on
// it without importing each other.

export const THEMES = ["dark", "light"] as const;

/**
 * Which way round the page is drawn.
 *
 * **Two, and there is no `system`.** Every other theme control has a third
 * position because it belongs to a program running *on* a desktop, with an OS
 * preference above it to defer to. This library dresses Domicile's own chrome,
 * and Domicile is the system — so `prefers-color-scheme` under it reports what
 * the engine was told rather than anything above the engine, and a `system`
 * here would be the desk deferring to itself.
 *
 * What the desk *is* on comes from outside this package entirely; see
 * {@link ThemeSource}.
 */
export type Theme = (typeof THEMES)[number];

/**
 * The theme a page is in before anything has said otherwise.
 *
 * Dark, because dark is the attribute-less state of `<html>` — the preset
 * publishes dark as `base` and light behind `[data-theme=light]` — and because
 * it is what `[theme] mode` in the compositor's config defaults to. The two
 * agree on purpose: a page that paints before the desk has told it anything
 * paints in the theme the desk most likely has.
 */
export const DEFAULT_THEME: Theme = "dark";

/** What the preset's `_light` condition selects on. */
const THEME_ATTRIBUTE = "data-theme";

/**
 * Put a theme on `<html>`, which is what makes the tokens resolve to it.
 *
 * Dark removes the attribute rather than setting `data-theme="dark"`: the
 * preset's condition is `[data-theme=light] &`, so dark is the absence and
 * writing it out would be a second spelling of the same state.
 *
 * Safe before React mounts — a shell calls it from its entry point so the
 * first paint is already the right way round.
 */
export const applyTheme = (theme: Theme): void => {
  const root = globalThis.document?.documentElement;
  if (theme === "light") {
    root?.setAttribute(THEME_ATTRIBUTE, "light");
  } else {
    root?.removeAttribute(THEME_ATTRIBUTE);
  }
};

/** The other one. A toggle with two positions flips rather than cycles. */
export const OTHER_THEME: Record<Theme, Theme> = {
  dark: "light",
  light: "dark",
};

export type FlipThemeOptions = {
  previous: Theme;
  next: Theme;
  /**
   * Flip the page's theme. Called inside the wipe's view transition update
   * callback (or synchronously in the no-wipe branch). Normally
   * {@link applyTheme}, so the design tokens resolve to the new theme's values.
   */
  applyNextTheme: () => void;
  /**
   * Turn the desk's windows, once the frame the wipe starts from is captured.
   * The wipe holds that frame until this settles — see
   * {@link ThemeSource.turnWindows}.
   */
  turnWindows: () => Promise<void>;
  /**
   * Commit the new theme to React state. Called inside `flushSync` after the
   * wipe finishes (and before the rise), so that the toggle's
   * `data-theme-mode` attribute has the new value committed *before* the slot
   * override is dropped — otherwise the OLD active slot would briefly retarget
   * center before React commits the NEW theme and re-parks it.
   */
  commitTheme: () => void;
};

/**
 * Run the ThemeSwitch's set → wipe → rise animation around a theme change.
 *
 * Wires `data-theme-setting` (slot sequencing) and `data-theme-flipping` /
 * `data-theme-flip-to` (page wipe) on `<html>`, runs the wipe via
 * `document.startViewTransition` where the browser supports it, and falls back
 * to a snap apply otherwise. Total animation: 150ms set + 500ms wipe + 200ms
 * rise, with the old frame held between set and wipe for as long as the
 * desk's windows take to turn.
 *
 * **Driven by the theme *arriving*, not by the click.** The desk owns the
 * theme, so a shell's toggle asks and the answer comes back to every page on
 * the desk — which means this also runs when the config is edited, or when the
 * toggle on another monitor is the one that was clicked. The click is not the
 * event; being told is.
 */
export const flipThemeWithAnimation = ({
  previous,
  next,
  applyNextTheme,
  commitTheme,
  turnWindows,
}: FlipThemeOptions): void => {
  const root = document.documentElement;
  // Phase 1 (set): force every slot below the window via the
  // `data-theme-setting` descendant rule. Only the currently active slot
  // actually moves.
  root.setAttribute("data-theme-setting", "");
  window.setTimeout(() => {
    const startRise = () => {
      // flushSync so the new `data-theme-mode` attribute is committed *before*
      // the override drops — otherwise removing `data-theme-setting` while the
      // attribute is still OLD would let the OLD active slot's target snap
      // back to translateY(0) and start rising before React commits the new
      // theme.
      flushSync(() => {
        commitTheme();
      });
      root.removeAttribute("data-theme-setting");
    };
    if (
      previous === next ||
      typeof document.startViewTransition !== "function"
    ) {
      // Nothing to wipe between, or nothing to wipe with: the slots still
      // set and rise, and the theme snaps over in between -- the windows'
      // too, which have nothing to wait for.
      applyNextTheme();
      turnWindows().catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a failed turnover
        console.error("Failed to turn the desk's windows", error);
      });
      startRise();
    } else {
      // Phase 2 (wipe). The two attributes drive the rules in the
      // pandacss preset: `data-theme-flipping` suppresses per-element
      // transitions so color changes don't bleed into the snapshots, and
      // `data-theme-flip-to` picks the wipe direction (dark = top-down,
      // light = bottom-up). Both are cleared in `finished`, immediately
      // before the rise triggers.
      root.setAttribute("data-theme-flipping", "");
      root.setAttribute("data-theme-flip-to", next);
      // The old frame is captured before this update runs, and the wipe
      // starts once it settles: the windows turn in between, behind a frame
      // that still shows them the old way.
      const transition = document.startViewTransition(() => {
        applyNextTheme();
        return turnWindows();
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

// The set phase's slot transition runs for `{durations.fast}` (see the
// `data-theme-setting` override in `slotStyles`). Source the JS timeout
// that ends the phase from the same token so the two can't drift.
const SET_DURATION_MS = Number.parseFloat(token("durations.fast"));
