// The bar's layout.

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
 * The bar's three columns. `middle` is centered on the screen regardless of the
 * other two, so a clock there does not shift as items change.
 */
export type TopBarLayout = {
  readonly left: readonly ReactNode[];
  readonly middle: readonly ReactNode[];
  readonly right: readonly ReactNode[];
};

/**
 * Manganese's default bar.
 *
 * The launcher button is first, next to the tray. The bell is last because the
 * drawer it opens slides out from that edge.
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
