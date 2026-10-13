import { createContext } from "react";

import { useProvided } from "../host/use-provided";

/** What opens the launcher, for a button outside it. */
export type LauncherControl = {
  /** Open the launcher, or close it if open. */
  toggle: () => void;
};

export const LauncherContext = createContext<LauncherControl | undefined>(
  undefined,
);

/** The launcher from {@link LauncherContext}. */
export const useLauncher = (): LauncherControl =>
  useProvided(LauncherContext, "the launcher (LauncherContext)");
