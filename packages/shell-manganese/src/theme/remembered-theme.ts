import { themeSchema } from "@domicile/chrome-sdk/theme";
import type { Theme } from "@domicile/component-library/theme-core";

// The one thing this shell keeps on the machine it is drawn on, and it is a
// guess rather than a setting.
//
// THE DESK OWNS THE THEME. It comes out of `[theme] mode` in the compositor's
// config, a toggle asks the compositor to change it, and the answer reaches
// every page on the desk and every Wayland client on it through the settings
// portal. None of that is this page's, and none of it is stored here.
//
// What IS this page's is the moment before the compositor has said anything.
// A shell is a document: it loads, it paints, and the handshake lands a few
// milliseconds later. With nothing remembered, a desk running light paints
// dark for those milliseconds and then wipes — which is exactly the flash the
// stylesheet was moved inside the bundle to end. So the last theme the desk
// was seen in is written down, applied before React mounts, and corrected by
// the first `theme` message like any other guess.
//
// It cannot be authoritative and is never read as though it were: the desk may
// have been reconfigured, or this may be a different desk. The first message
// wins, and a disagreement is a wipe rather than an error.

/**
 * Where the guess is kept.
 *
 * Suffixed, per the versioning rule for persisted state: `theme:v1` held a
 * three-valued *preference* — `light`, `dark` or `system` — from when this
 * shell owned its own theme and `system` meant `prefers-color-scheme`. Neither
 * the meaning nor the value set survives, so an old key must not be read as a
 * new one: `system` would parse as nothing and, under the old code, `dark`
 * meant "the user chose dark" where it now means "the desk was last seen
 * dark". A new key leaves the old value to be ignored and eventually dropped.
 */
const THEME_KEY = "theme:v2";

/**
 * The theme the desk was last seen in, or `undefined` for a machine that has
 * not seen one.
 *
 * Safe before React mounts, which is the whole point of it: the shell's entry
 * point applies this so the first paint is probably right.
 */
export const rememberedTheme = (): Theme | undefined => {
  const stored = globalThis.localStorage?.getItem(THEME_KEY);
  // Parsed rather than cast, because this crossed a runtime boundary and
  // anything at all can be under that key — a value this build does not know
  // is a guess it cannot make rather than a theme.
  return stored === null || stored === undefined
    ? undefined
    : themeSchema.safeParse(stored).data;
};

/** Write down the theme the desk is in, for the next time this page loads. */
export const rememberTheme = (theme: Theme): void => {
  globalThis.localStorage?.setItem(THEME_KEY, theme);
};
