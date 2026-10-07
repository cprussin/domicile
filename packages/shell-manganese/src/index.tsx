// Manganese's entry point and library API. `runManganese` builds a `Shell` that
// takes the desktop it is handed and mounts the React chrome; `Shell` is the
// default build. Bar items are exported for custom layouts. Importing this
// module only installs its stylesheet.

import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

import type { ApplicationsOptions } from "./launcher/applications-config";
import { applicationsConfigSchema } from "./launcher/applications-config";
import { mountManganese } from "./mount-manganese";
import type { TopBarLayout } from "./top-bar/layout";

import "./global.css";

export {
  clipboard,
  DEFAULT_KEYBINDINGS,
  DEFAULT_MODES,
  exec,
  floating,
  focus,
  fullscreen,
  grow,
  kill,
  launcher,
  layout,
  lock,
  mode,
  move,
  moveToWorkspace,
  scratchpad,
  split,
  type Way,
  workspace,
} from "./keyboard/commands";
export {
  BarBattery as Battery,
  BarBluetooth as Bluetooth,
  BarBrightness as Brightness,
  BarClock as Clock,
  BarLauncher as Launcher,
  BarMode as Mode,
  BarNetwork as Network,
  BarNotifications as Notifications,
  BarSharing as Sharing,
  BarThemeSelector as ThemeSelector,
  BarTray as Tray,
  BarVolume as Volume,
  BarWorkspaces as WorkspaceSwitcher,
} from "./top-bar/bar-items";
export { DEFAULT_TOP_BAR, type TopBarLayout } from "./top-bar/layout";

/** Options for `runManganese`. */
export type ManganeseOptions = {
  /**
   * What the launcher offers beside files: `omit`, desktop file IDs to hide,
   * and `bookmarks`, pages to open by name. See `docs/LAUNCHER.md`.
   */
  readonly applications?: ApplicationsOptions;
  /**
   * Shell keybindings, below any the config binds. Defaults to
   * `DEFAULT_KEYBINDINGS` and `DEFAULT_MODES` (sway's, on Meta).
   */
  readonly keybindings?: ShellKeybindings;
  /** Layout of every monitor's bar. Defaults to manganese's own. */
  readonly topBar?: TopBarLayout;
};

/** Build a `Shell` that mounts manganese with `options`. */
export const runManganese = (options: ManganeseOptions = {}): ShellModule => {
  // Parsed when the config is built, so a bad bookmark fails it.
  const applications = applicationsConfigSchema.parse(options.applications);
  return (root, domicile) => {
    mountManganese(root, domicile, { ...options, applications });
  };
};

/** The default shell, loaded by `"shell": "@domicile-desktop/manganese"`. */
export const Shell: ShellModule = runManganese();
