// Keeps the page in the desktop's theme, so the splash matches the shell that
// replaces it.

import {
  applyTheme,
  DEFAULT_THEME,
} from "@domicile-desktop/component-library/theme-core";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

/**
 * Applies the desktop's theme now and on each change. Returns a function that
 * stops following it. Dark until the compositor says, as `theme.mode` is.
 */
export const followTheme = (domicile: DomicileHost): (() => void) => {
  const themed = () => {
    applyTheme(domicile.theme ?? DEFAULT_THEME);
  };
  themed();
  domicile.addEventListener("themechanged", themed);
  return () => {
    domicile.removeEventListener("themechanged", themed);
  };
};
