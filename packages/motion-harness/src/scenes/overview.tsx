// The overview on one 960x540 screen: kitty on workspace 1, foot and a
// browser on workspace 2, and nvim on workspace 3, which is shown.

import { OverviewBackdrop } from "@domicile-desktop/manganese-window-management/overview/OverviewBackdrop";
import { OverviewPicker } from "@domicile-desktop/manganese-window-management/overview/OverviewPicker";
import { screenOverviewsOf } from "@domicile-desktop/manganese-window-management/overview/overview";
import { useOverviewPhase } from "@domicile-desktop/manganese-window-management/overview/useOverviewPhase";
import type { Geometry } from "@domicile-desktop/manganese-window-management/placement";
import { placementsOf } from "@domicile-desktop/manganese-window-management/placement";
import type { StageScreen } from "@domicile-desktop/manganese-window-management/screens/stage-screens";
import type { WindowState } from "@domicile-desktop/manganese-window-management/window-state";
import {
  currentHere,
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
  workspaceHere,
} from "@domicile-desktop/manganese-window-management/window-state";

import type { SceneProps } from "../motion";

const RECT = { height: 540, width: 960, x: 0, y: 0 };

// The default screen, where `NO_WINDOWS` puts every window, under a 24px bar.
const GEOMETRY: Geometry = {
  desktop: RECT,
  name: "",
  screen: RECT,
  workspace: { height: 516, width: 960, x: 0, y: 24 },
};

const STATE: WindowState = [
  WindowAction.AppAppeared("kitty", "kitty"),
  WindowAction.WorkspaceSelected("2"),
  WindowAction.AppAppeared("foot", "foot"),
  WindowAction.AppAppeared("browser", "browser"),
  WindowAction.WorkspaceSelected("3"),
  WindowAction.AppAppeared("nvim", "nvim"),
].reduce(reduceWindows, NO_WINDOWS);

const SWAPPED = reduceWindows(STATE, WindowAction.WorkspacesSwapped("1", "3"));

/** The overview opens, and closes when played back. */
export const OverviewOpenScene = ({ played }: SceneProps) => {
  const { closed, phase } = useOverviewPhase(played);
  return phase === undefined ? undefined : (
    <Overview closing={phase === "closing"} onClosed={closed} state={STATE} />
  );
};

/** Workspaces 1 and 3 swap places in the open overview. */
export const OverviewSwapScene = ({ played }: SceneProps) => (
  <Overview
    closing={false}
    onClosed={ignored}
    state={played ? SWAPPED : STATE}
  />
);

type OverviewProps = {
  closing: boolean;
  onClosed: () => void;
  state: WindowState;
};

/** The overview of `state` on the scene's screen, as the desktop draws it. */
const Overview = ({ closing, onClosed, state }: OverviewProps) => {
  const screen: StageScreen = {
    current: currentHere(state),
    floats: [],
    fullscreen: undefined,
    geometry: GEOMETRY,
    screenful: placementsOf(workspaceHere(state), GEOMETRY, 0),
  };
  const overviews = screenOverviewsOf(state, [screen], closing);
  return (
    <>
      <OverviewBackdrop
        cards={state.overviewCards}
        closing={closing}
        onClosed={onClosed}
        overviews={overviews}
      />
      {!closing && (
        <OverviewPicker
          aim={undefined}
          cards={state.overviewCards}
          focused=""
          onAim={ignored}
          onDismiss={ignored}
          onMove={ignored}
          onPick={ignored}
          onPickWindow={ignored}
          overviews={overviews}
        />
      )}
    </>
  );
};

const ignored = () => {
  /* the scene plays one motion; the overview's own controls do nothing */
};
