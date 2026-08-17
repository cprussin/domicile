import type { PropsWithChildren } from "react";

import { ThemeProvider } from "../ThemeSwitch/ThemeProvider";

/**
 * The single entry point for the component library's runtime context. Mount it
 * once around the app root and every library feature that needs a provider is
 * wired — in the right order — behind this one component: today just the theme
 * controller, tomorrow whatever app config or additional providers we add. App
 * code composes one `<Provider>` and can't forget a provider or nest them wrong.
 */
export const Provider = ({ children }: PropsWithChildren) => (
  <ThemeProvider>{children}</ThemeProvider>
);
