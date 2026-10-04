// Manganese's entry point and library API. `runManganese` builds a `Shell` that
// connects to the host and mounts the React chrome; `Shell` is the default
// build. Bar items are exported for custom layouts. Importing this module only
// installs its stylesheet.

import { standaloneThemeSource } from "@domicile-desktop/component-library/standalone-theme-source";
import {
  applyTheme,
  DEFAULT_THEME,
} from "@domicile-desktop/component-library/theme-core";
import { connectToHost, hasHost } from "@domicile-desktop/sdk/connect-to-host";
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { createRoot } from "react-dom/client";

import { mountPoint } from "./mount-point";
import { Shell as Chrome } from "./Shell";
import { hostDisplays } from "./screens/host-displays";
import { viewportDisplays } from "./screens/viewport-displays";
import { hostTheme } from "./theme/host-theme";
import { rememberedTheme } from "./theme/remembered-theme";
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
  BarBrightness as Brightness,
  BarClock as Clock,
  BarLauncher as Launcher,
  BarMode as Mode,
  BarNotifications as Notifications,
  BarThemeSelector as ThemeSelector,
  BarTray as Tray,
  BarVolume as Volume,
  BarWorkspaces as WorkspaceSwitcher,
} from "./top-bar/bar-items";
export { DEFAULT_TOP_BAR, type TopBarLayout } from "./top-bar/layout";

/** Options for `runManganese`. */
export type ManganeseOptions = {
  /**
   * Shell keybindings, below any the config binds. Defaults to
   * `DEFAULT_KEYBINDINGS` and `DEFAULT_MODES` (sway's, on Meta).
   */
  readonly keybindings?: ShellKeybindings;
  /** Layout of every monitor's bar. Defaults to manganese's own. */
  readonly topBar?: TopBarLayout;
};

/** Build a `Shell` that mounts manganese with `options`. */
export const runManganese =
  (options: ManganeseOptions = {}): ShellModule =>
  (root) => {
    // Apply the last-seen theme before React mounts to avoid a theme flash on
    // first paint (the stylesheet ships in this module; see
    // `@domicile-desktop/component-library/vite-shell`). The compositor owns the
    // theme (`theme.mode`) and sends it with the handshake, which corrects this
    // guess. Defaults to dark, matching `theme.mode`'s default.
    applyTheme(rememberedTheme() ?? DEFAULT_THEME);

    // Under the engine this is `window.domicile`. In a plain browser,
    // `connectToHost` logs a warning and returns a no-op stand-in, so the shell
    // still opens for styling work.
    const domicile = new DomicileClient(connectToHost(window));

    // Without a host, the browser window is the only display. Built once here,
    // not per render, because a source holds the connection.
    const displays = hasHost(window)
      ? hostDisplays(domicile)
      : viewportDisplays(window);

    // With a host, the compositor owns the theme and the toggle asks it to
    // change. Without one, the toggle sets the theme locally. Built once
    // because a source holds the connection.
    const theme = hasHost(window)
      ? hostTheme(domicile)
      : standaloneThemeSource(rememberedTheme());
    registerElements(domicile);

    createRoot(mountPoint(root)).render(
      <Chrome
        displays={displays}
        domicile={domicile}
        keybindings={options.keybindings}
        theme={theme}
        topBar={options.topBar}
      />,
    );
  };

/** The default shell, loaded by `"shell": "@domicile-desktop/manganese"`. */
export const Shell: ShellModule = runManganese();
