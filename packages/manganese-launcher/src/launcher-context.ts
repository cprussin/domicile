import { useProvided } from "@domicile-desktop/manganese-host/use-provided";
import { createContext } from "react";

/** What opens the launcher, for a button outside it. */
export type LauncherControl = {
  /**
   * Open the launcher, or close it if open. `from` is the button pressed, for
   * the launcher to spring from.
   */
  toggle: (from?: Element) => void;
};

export const LauncherContext = createContext<LauncherControl | undefined>(
  undefined,
);

/** The launcher from {@link LauncherContext}. */
export const useLauncher = (): LauncherControl =>
  useProvided(LauncherContext, "the launcher (LauncherContext)");
