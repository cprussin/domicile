// The workspaces, for the bar's switcher and binding mode.

import { createContext } from "react";

import { useProvided } from "../host/use-provided";
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
  /** Show workspace `name`. */
  select: (name: string) => void;
};

export const WorkspacesContext = createContext<Workspaces | undefined>(
  undefined,
);

/** The workspaces from {@link WorkspacesContext}. */
export const useWorkspaces = (): Workspaces =>
  useProvided(WorkspacesContext, "the workspaces (WorkspacesContext)");
