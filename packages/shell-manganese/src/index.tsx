// The shell's entry point, and manganese as a library: `runManganese` makes a
// `Shell` that wires the SDK to whatever host this page was opened under and
// mounts the React chrome on top of it, and `Shell` is manganese as shipped.
// The bar's items are exported for a layout of the user's own. Importing this
// module does nothing but install its stylesheet.

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

/** What a desktop of manganese's can be told, all of it optional. */
export type ManganeseOptions = {
  /**
   * The keys this desktop binds — `keybindings` for mode `default`, `modes`
   * for the rest — under any the config binds: `DEFAULT_KEYBINDINGS` and
   * `DEFAULT_MODES`, sway's on Meta, when not given.
   */
  readonly keybindings?: ShellKeybindings;
  /** What goes on every monitor's bar: manganese's own when not given. */
  readonly topBar?: TopBarLayout;
};

/** Manganese with `options`, as a `Shell` that mounts it into `root`. */
export const runManganese =
  (options: ManganeseOptions = {}): ShellModule =>
  (root) => {
    // The theme this desk was last seen in, before React mounts, so the first
    // paint uses the right semantic-token values. There is no paint before this:
    // the stylesheet travels inside this module rather than in a render-blocking
    // `<link>`, which is what ends this shell's theme flash — see
    // `@domicile-desktop/component-library/vite-shell`.
    //
    // **A guess, and the only thing this shell keeps on the machine.** The theme
    // belongs to the desktop — `theme.mode` in the compositor's config, changed
    // by the toggle on the bar, and handed to every Wayland client on the desk
    // through the settings portal — and it arrives a few milliseconds from now
    // with the handshake. This is what to paint in until it does, and the first
    // message corrects it with the wipe. A machine that has never seen this desk
    // gets dark, which is both the attribute-less state of `<html>` and what
    // `theme.mode` defaults to.
    applyTheme(rememberedTheme() ?? DEFAULT_THEME);

    // One call, two places. Under the fork this is `window.domicile`, the
    // control channel the engine puts on a document it served; in a plain browser
    // there is none, and `connectToHost` says so on the console and hands back a
    // stand-in that does nothing — so the shell still opens for styling work
    // against a desktop that will never arrive.
    const domicile = new DomicileClient(connectToHost(window));

    // And where the desktop comes from, which is the same question one answer
    // later: a host describes one, and with no host nothing ever will, so the
    // window is the only geometry there is. Built here rather than in the chrome
    // because this is where the host's absence is already known, and once rather
    // than per render because a source is the connection.
    const displays = hasHost(window)
      ? hostDisplays(domicile)
      : viewportDisplays(window);

    // And the theme, which is the same question asked again. With a host the desk
    // owns it: the toggle asks, the compositor answers, and
    // the desk's GTK and Qt windows are told through the settings portal. With no
    // host there is nobody to ask and nobody else to tell, so the toggle answers
    // itself — which is what makes the shell styleable in an ordinary browser.
    // Built once, outside the component, because a source is the connection.
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

/** Manganese as shipped: what `"shell": "@domicile-desktop/manganese"` loads. */
export const Shell: ShellModule = runManganese();
