// What goes on the bar, and where.

import type { ReactNode } from "react";

import {
  BarBattery,
  BarBrightness,
  BarClock,
  BarLauncher,
  BarMode,
  BarNotifications,
  BarThemeSelector,
  BarTray,
  BarVolume,
  BarWorkspaces,
} from "./bar-items";

/**
 * The bar's three columns. `middle` is centered on the screen whatever is in
 * the other two, so a clock there does not shift along as windows open.
 */
export type TopBarLayout = {
  readonly left: readonly ReactNode[];
  readonly middle: readonly ReactNode[];
  readonly right: readonly ReactNode[];
};

/**
 * Manganese's own bar.
 *
 * **The launcher's button is first, at the far start**, right against the
 * tray. **The tray is left of the workspaces.** **The bell is last, at the far end**, because the
 * drawer it opens slides out from that edge: the control and what it opens are
 * on the same side of the screen.
 */
export const DEFAULT_TOP_BAR: TopBarLayout = {
  left: [
    <BarLauncher key="launcher" />,
    <BarTray key="tray" />,
    <BarWorkspaces key="workspaces" />,
  ],
  middle: [<BarClock key="clock" />],
  right: [
    <BarMode key="mode" />,
    <BarThemeSelector key="theme" />,
    <BarVolume key="volume" />,
    <BarBrightness key="brightness" />,
    <BarBattery key="battery" />,
    <BarNotifications key="notifications" />,
  ],
};
