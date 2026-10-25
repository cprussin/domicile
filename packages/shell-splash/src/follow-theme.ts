// Keeps the page in the desktop's theme, so the splash matches the shell that
// replaces it.

import {
  applyTheme,
  DEFAULT_THEME,
} from "@domicile-desktop/component-library/theme-core";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";

/**
 * Applies the desktop's theme now and on each change. Returns a function that
 * stops following it. Dark until the compositor says, as `theme.mode` is.
 */
export const followTheme = ({
  theme,
}: Pick<Domicile, "theme">): (() => void) => {
  const themed = () => {
    applyTheme(theme.current ?? DEFAULT_THEME);
  };
  themed();
  return theme.on("change", themed);
};
