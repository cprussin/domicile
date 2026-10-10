import type { Display } from "@domicile-desktop/component-library/display-source";
import { useMemo, useState } from "react";

import type { WindowState } from "../window-management/window-state";
import type { LaidOut, StageScreen } from "./stage-screens";
import { stageScreensOf } from "./stage-screens";

/** The desk before the host describes one. One array, so it is cached once. */
const NO_DESK: readonly Display[] = [];

/**
 * Every screen the stage draws, laid out again only when its workspace or the
 * desk changes.
 *
 * Keyed on the screens and workspaces alone, so a key press, a mode change or
 * a retitled window keeps every screen and its placements. `useWindowMotion`
 * compares placements by identity.
 *
 * @param desk - the host's displays, `undefined` until it describes them.
 */
export const useStageScreens = (
  { screens, workspaces }: Pick<WindowState, "screens" | "workspaces">,
  desk: readonly Display[] | undefined,
): readonly StageScreen[] => {
  const [laidOut] = useState<LaidOut>(() => new WeakMap());
  return useMemo(
    () => stageScreensOf({ screens, workspaces }, desk ?? NO_DESK, laidOut),
    [desk, laidOut, screens, workspaces],
  );
};
