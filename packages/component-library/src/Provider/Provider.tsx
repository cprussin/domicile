import type { PropsWithChildren } from "react";

import { ThemeProvider } from "../ThemeSwitch/ThemeProvider";
import type { ThemeSource } from "../ThemeSwitch/theme-source";

type Props = {
  /**
   * Reads the theme and handles toggle requests.
   *
   * Required, because the theme belongs to the desktop and must reach other
   * monitors and Wayland clients. A page with no desktop passes
   * `standaloneThemeSource()`.
   */
  theme: ThemeSource;
};

/**
 * Provides all of the component library's runtime context. Mount once at the
 * app root.
 */
export const Provider = ({ children, theme }: PropsWithChildren<Props>) => (
  <ThemeProvider source={theme}>{children}</ThemeProvider>
);
