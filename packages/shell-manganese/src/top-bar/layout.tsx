// The bar's layout.

import type { ReactNode } from "react";

import {
  BarBattery,
  BarBluetooth,
  BarBrightness,
  BarClock,
  BarLauncher,
  BarMode,
  BarNetwork,
  BarNotifications,
  BarSharing,
  BarThemeSelector,
  BarTray,
  BarVolume,
  BarWorkspaces,
} from "./bar-items";

/**
 * The bar's three columns. `center` is centered on the screen regardless of the
 * other two, so a clock there does not shift as items change.
 */
export type BarLayout = {
  readonly left: readonly ReactNode[];
  readonly center: readonly ReactNode[];
  readonly right: readonly ReactNode[];
};

/**
 * Manganese's default bar.
 *
 * The launcher button is first, next to the tray. The sharing indicator leads
 * the right column, so it is seen. The bell is last because the drawer it
 * opens slides out from that edge.
 */
export const DEFAULT_BAR: BarLayout = {
  center: [<BarClock key="clock" />],
  left: [
    <BarLauncher key="launcher" />,
    <BarTray key="tray" />,
    <BarWorkspaces key="workspaces" />,
  ],
  right: [
    <BarSharing key="sharing" />,
    <BarMode key="mode" />,
    <BarThemeSelector key="theme" />,
    <BarBrightness key="brightness" />,
    <BarVolume key="volume" />,
    <BarBluetooth key="bluetooth" />,
    <BarNetwork key="network" />,
    <BarBattery key="battery" />,
    <BarNotifications key="notifications" />,
  ],
};

/**
 * The lock screen's bar: the readouts a locked desktop allows, in the default
 * bar's order.
 */
export const LOCK_BAR: BarLayout = {
  center: [],
  left: [],
  right: [
    <BarBrightness key="brightness" />,
    <BarVolume key="volume" />,
    <BarBluetooth key="bluetooth" />,
    <BarBattery key="battery" />,
  ],
};
