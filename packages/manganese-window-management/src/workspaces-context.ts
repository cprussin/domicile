// The workspaces, for the bar's switcher, its overview button and the binding
// mode.

import { useProvided } from "@domicile-desktop/manganese-host/use-provided";
import { createContext } from "react";
import type { WindowState } from "./window-state";

export type Workspaces = {
  /** The workspace each screen shows, by screen name. */
  current: Readonly<Record<string, string>>;
  /** The screen with keyboard focus. */
  focused: string;
  /** The screen each workspace lives on. */
  homes: WindowState["homes"];
  /** The current binding mode. */
  mode: string;
  /** Whether the overview is open. */
  overviewOpen: boolean;
  /** Show workspace `name`. */
  select: (name: string) => void;
  /** Open or close the overview. */
  toggleOverview: () => void;
};

export const WorkspacesContext = createContext<Workspaces | undefined>(
  undefined,
);

/** The workspaces from {@link WorkspacesContext}. */
export const useWorkspaces = (): Workspaces =>
  useProvided(WorkspacesContext, "the workspaces (WorkspacesContext)");
