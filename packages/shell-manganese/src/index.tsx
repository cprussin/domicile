// Manganese's entry point and library API. `runManganese` builds a `Shell` that
// takes the desktop it is handed and mounts the React chrome; `Shell` is the
// default build. Bar items are exported for custom layouts. Importing this
// module only installs its stylesheet.

import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

import type { ApplicationsOptions } from "./launcher/applications-config";
import { applicationsConfigSchema } from "./launcher/applications-config";
import { mountManganese } from "./mount-manganese";
import type { BarLayout } from "./top-bar/layout";
import type { FloatingOptions } from "./window-management/floating/floating-rules";
import { floatingRulesSchema } from "./window-management/floating/floating-rules";

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
  searchClipboard,
  split,
  type Way,
  workspace,
} from "./keyboard/commands";
export {
  BarBattery as Battery,
  BarBluetooth as Bluetooth,
  BarBrightness as Brightness,
  BarClock as Clock,
  BarLauncher as LauncherButton,
  BarMode as Mode,
  BarNetwork as Network,
  BarNotifications as Notifications,
  BarSharing as Sharing,
  BarThemeSelector as ThemeSwitch,
  BarTray as Tray,
  BarVolume as Volume,
  BarWorkspaces as WorkspaceSwitcher,
} from "./top-bar/bar-items";
export { type BarLayout, DEFAULT_BAR } from "./top-bar/layout";

/** Options for `runManganese`. */
export type ManganeseOptions = {
  /**
   * What the launcher offers beside files: `omit`, desktop file IDs to hide,
   * and `bookmarks`, pages to open by name. See `docs/LAUNCHER.md`.
   */
  readonly applications?: ApplicationsOptions;
  /**
   * Each monitor's bar: `left`, `center` and `right` columns of items, such as
   * `[<Clock />]`. Defaults to `DEFAULT_BAR`. See `docs/TOP-BAR.md`.
   */
  readonly bar?: BarLayout;
  /**
   * Client windows that open floating at the size they drew, as sway's
   * `for_window [app_id=…] floating enable`. Each rule matches regular
   * expressions on the `app` id and `title`. Dialogs float without one. See
   * `docs/WINDOW-MANAGEMENT.md`.
   */
  readonly floating?: FloatingOptions;
  /**
   * Shell keybindings, below any the config binds. Defaults to
   * `DEFAULT_KEYBINDINGS` and `DEFAULT_MODES` (sway's, on Meta).
   */
  readonly keybindings?: ShellKeybindings;
};

/** Build a `Shell` that mounts manganese with `options`. */
export const runManganese = (options: ManganeseOptions = {}): ShellModule => {
  // Parsed when the config is built, so a bad bookmark or pattern fails it.
  const applications = applicationsConfigSchema.parse(options.applications);
  const floating = floatingRulesSchema.parse(options.floating);
  return (root, domicile) => {
    mountManganese(root, domicile, { ...options, applications, floating });
  };
};

/** The default shell, loaded by `"shell": "@domicile-desktop/manganese"`. */
export const Shell: ShellModule = runManganese();
