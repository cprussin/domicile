// Manganese's bars.

import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import { Battery } from "@domicile-desktop/manganese-bar-module-battery";
import { Bluetooth } from "@domicile-desktop/manganese-bar-module-bluetooth";
import { Brightness } from "@domicile-desktop/manganese-bar-module-brightness";
import { Cast } from "@domicile-desktop/manganese-bar-module-cast";
import { Clock } from "@domicile-desktop/manganese-bar-module-clock";
import { IdleInhibitor } from "@domicile-desktop/manganese-bar-module-idle-inhibitor";
import { Keymap } from "@domicile-desktop/manganese-bar-module-keymap";
import { LauncherButton } from "@domicile-desktop/manganese-bar-module-launcher-button";
import { Network } from "@domicile-desktop/manganese-bar-module-network";
import { Notifications } from "@domicile-desktop/manganese-bar-module-notifications";
import { Sharing } from "@domicile-desktop/manganese-bar-module-sharing";
import { ThemeSwitch } from "@domicile-desktop/manganese-bar-module-theme-switch";
import { Tray } from "@domicile-desktop/manganese-bar-module-tray";
import { Volume } from "@domicile-desktop/manganese-bar-module-volume";
import { WorkspaceSwitcher } from "@domicile-desktop/manganese-bar-module-workspace-switcher";

/**
 * Manganese's default bar.
 *
 * The launcher button is first, next to the tray. The sharing indicator leads
 * the right column, so it is seen, with casting to TVs beside it. The
 * keymap, which shows only on a keyboard with several, is next. The bell is
 * last because the drawer it opens slides out from that edge.
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
    <ThemeSwitch key="theme" />,
    <IdleInhibitor key="idle-inhibitor" />,
    <Brightness key="brightness" />,
    <Volume key="volume" />,
    <Bluetooth key="bluetooth" />,
    <Network key="network" />,
    <Battery key="battery" />,
    <Notifications key="notifications" />,
  ],
};

/**
 * The lock screen's bar: the readouts a locked desktop allows, in the default
 * bar's order. The keymap switches there too, so the passphrase is typed on
 * the right one.
 */
export const LOCK_BAR: BarLayout = {
  center: [],
  left: [],
  right: [
    <Keymap key="keymap" />,
    <Brightness key="brightness" />,
    <Volume key="volume" />,
    <Bluetooth key="bluetooth" />,
    <Battery key="battery" />,
  ],
};
