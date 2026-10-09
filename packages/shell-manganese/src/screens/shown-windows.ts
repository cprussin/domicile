import { ShownWindow } from "@domicile-desktop/component-library/shown-windows";
import { appIdOf, browserIdOf } from "../window-management/window";
import type { StageScreen } from "./stage-screens";

/**
 * The windows on screen, each with its whole frame: its bar and contents. A
 * hidden tab shows only its bar, so it is left out.
 */
export const shownWindowsOf = (
  screens: readonly StageScreen[],
): ShownWindow[] =>
  screens.flatMap(({ screenful }) =>
    screenful.placements.flatMap(({ frame, id, surface }) =>
      surface === undefined ? [] : [shownWindow(id, frame)],
    ),
  );

/** Window `id` shown in `frame`. */
const shownWindow = (id: string, frame: ShownWindow["box"]): ShownWindow => {
  const appId = appIdOf(id);
  const browser = browserIdOf(id);
  if (appId !== undefined) {
    return ShownWindow.App(appId, frame);
  } else if (browser === undefined) {
    throw new Error(`shell: window ${id} is neither a client's nor a browser`);
  } else {
    return ShownWindow.Browser(browser, frame);
  }
};
