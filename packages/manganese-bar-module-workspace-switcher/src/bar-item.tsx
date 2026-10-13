import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { workspacesOn } from "@domicile-desktop/manganese-window-management/window-state";
import { useWorkspaces } from "@domicile-desktop/manganese-window-management/workspaces-context";
import { useMemo } from "react";
import { Workspaces } from "./Workspaces";

/** This screen's workspaces, with the visible one marked. */
export const WorkspaceSwitcher = () => {
  const { screen } = useBar();
  const { current, focused, homes, select } = useWorkspaces();
  const workspaces = useMemo(
    () => workspacesOn({ homes }, screen),
    [homes, screen],
  );
  return (
    <Workspaces
      current={shownOn(current, screen)}
      focused={focused === screen}
      onSelect={select}
      workspaces={workspaces}
    />
  );
};

/** The workspace `screen` shows. Throws for a screen with none. */
const shownOn = (
  current: Readonly<Record<string, string>>,
  screen: string,
): string => {
  const workspace = current[screen];
  if (workspace === undefined) {
    throw new Error(`manganese: screen ${screen} shows no workspace`);
  } else {
    return workspace;
  }
};
