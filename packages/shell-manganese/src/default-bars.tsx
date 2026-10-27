// Manganese's bars.

import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import { Cast } from "@domicile-desktop/manganese-bar-module-cast";
import { Clock } from "@domicile-desktop/manganese-bar-module-clock";
import { Keymap } from "@domicile-desktop/manganese-bar-module-keymap";
import { LauncherButton } from "@domicile-desktop/manganese-bar-module-launcher-button";
import { Notifications } from "@domicile-desktop/manganese-bar-module-notifications";
import { Sharing } from "@domicile-desktop/manganese-bar-module-sharing";
import { Tray } from "@domicile-desktop/manganese-bar-module-tray";
import { WorkspaceSwitcher } from "@domicile-desktop/manganese-bar-module-workspace-switcher";
import { QuickSettings } from "./quick-settings/QuickSettings";

/**
 * Manganese's default bar.
 *
 * The launcher button is first, next to the tray. The sharing indicator leads
 * the right column, so it is seen, with casting to TVs beside it. The
 * keymap, which shows only on a keyboard with several, is next, then quick
 * settings. The bell is last because the drawer it opens slides out from that
 * edge.
 */
export const DEFAULT_BAR: BarLayout = {
  center: [<Clock key="clock" />],
  left: [
    <LauncherButton key="launcher" />,
    <Tray key="tray" />,
    <WorkspaceSwitcher key="workspaces" />,
  ],
  right: [
    <Sharing key="sharing" />,
    <Cast key="cast" />,
    <Keymap key="keymap" />,
    <QuickSettings key="quick-settings" />,
    <Notifications key="notifications" />,
  ],
};

/**
 * The lock screen's bar: the keymap, so the passphrase is typed on the right
 * one, and quick settings, which offers what a locked desktop allows.
 */
export const LOCK_BAR: BarLayout = {
  center: [],
  left: [],
  right: [<Keymap key="keymap" />, <QuickSettings key="quick-settings" />],
};
