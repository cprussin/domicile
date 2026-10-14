import { ShownWindow } from "@domicile-desktop/component-library/shown-windows";
import { appIdOf, browserIdOf } from "../window";
import type { StageScreen } from "./stage-screens";

/**
 * The windows on screen, each cropped to its contents, for the screenshot
 * picker to outline. A hidden tab has no contents on screen, so it is left
 * out.
 */
export const shownWindowsOf = (
  screens: readonly StageScreen[],
): ShownWindow[] =>
  screens.flatMap(({ screenful }) =>
    screenful.placements.flatMap(({ id, surface }) =>
      surface === undefined ? [] : [shownWindow(id, surface)],
    ),
  );

/** Window `id` shown in `box`. */
const shownWindow = (id: string, box: ShownWindow["box"]): ShownWindow => {
  const appId = appIdOf(id);
  const browser = browserIdOf(id);
  if (appId !== undefined) {
    return ShownWindow.App(appId, box);
  } else if (browser === undefined) {
    throw new Error(`shell: window ${id} is neither a client's nor a browser`);
  } else {
    return ShownWindow.Browser(browser, box);
  }
};
