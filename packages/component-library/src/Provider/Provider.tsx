import type { PropsWithChildren } from "react";

import { ThemeProvider } from "../ThemeSwitch/ThemeProvider";
import type { ThemeSource } from "../ThemeSwitch/theme-source";

type Props = {
  /**
   * Where the theme comes from, and what a toggle asks when it is clicked.
   *
   * Required rather than defaulted, because the default that suggests itself —
   * keep the theme in this page — is the one wrong answer. The theme belongs
   * to the desktop: it has to reach the other monitors and the desk's Wayland
   * clients, and a page that quietly kept its own would be the only thing that
   * changed. A page with no desk behind it says so out loud with
   * `standaloneThemeSource()`.
   */
  theme: ThemeSource;
};

/**
 * The single entry point for the component library's runtime context. Mount it
 * once around the app root and every library feature that needs a provider is
 * wired — in the right order — behind this one component: today just the theme
 * controller, tomorrow whatever app config or additional providers we add. App
 * code composes one `<Provider>` and can't forget a provider or nest them wrong.
 */
export const Provider = ({ children, theme }: PropsWithChildren<Props>) => (
  <ThemeProvider source={theme}>{children}</ThemeProvider>
);
