import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { themeSchema } from "@domicile-desktop/sdk/theme";

// The last theme the desktop was seen in, stored locally as a guess for the
// first paint.
//
// The compositor owns the theme (`theme.mode` in its config) and sends it in
// the handshake a few milliseconds after the page loads. Applying the
// remembered theme before React mounts avoids a flash of the wrong theme. The
// first `theme` message always wins; a mismatch triggers a wipe.

/**
 * The storage key.
 *
 * Versioned per the persisted-state rule. `theme:v1` stored a user preference
 * (`light`, `dark` or `system`) with a different meaning, so it must not be
 * read as this value.
 */
const THEME_KEY = "theme:v2";

/**
 * The theme the desktop was last seen in, or `undefined` if none was stored.
 *
 * Safe to call before React mounts; the entry point uses it for the first
 * paint.
 */
export const rememberedTheme = (): Theme | undefined => {
  const stored = globalThis.localStorage?.getItem(THEME_KEY);
  // Parsed rather than cast: anything can be stored under the key, so an
  // unknown value returns `undefined`.
  return stored === null || stored === undefined
    ? undefined
    : themeSchema.safeParse(stored).data;
};

/** Store the current theme for the next page load. */
export const rememberTheme = (theme: Theme): void => {
  globalThis.localStorage?.setItem(THEME_KEY, theme);
};
