import type { Display } from "@domicile-desktop/component-library/display-source";
import { useMemo, useState } from "react";

import type { WindowState } from "../window-state";
import type { LaidOut, StageScreen } from "./stage-screens";
import { stageScreensOf } from "./stage-screens";

/** The desk before the host describes one. One array, so it is cached once. */
const NO_DESK: readonly Display[] = [];

/**
 * Every screen the stage draws, laid out again only when its workspace, the
 * floats stacked under it or the desk changes.
 *
 * Keyed on the screens, the focused screen and the workspaces alone, so a key press, a mode change or
 * a retitled window keeps every screen and its placements. `useWindowMotion`
 * compares placements by identity.
 *
 * @param desk - the host's displays, `undefined` until it describes them.
 */
export const useStageScreens = (
  {
    focused,
    screens,
    workspaces,
  }: Pick<WindowState, "focused" | "screens" | "workspaces">,
  desk: readonly Display[] | undefined,
): readonly StageScreen[] => {
  const [laidOut] = useState<LaidOut>(() => ({
    byDesk: new WeakMap(),
    last: new Map(),
  }));
  return useMemo(
    () =>
      stageScreensOf(
        { focused, screens, workspaces },
        desk ?? NO_DESK,
        laidOut,
      ),
    [desk, focused, laidOut, screens, workspaces],
  );
};
