// Manganese's entry point. `runManganese` builds a `Shell` that takes the
// desktop it is handed and mounts the React chrome; `Shell` is the default
// build. Bar items, commands and the rest live in the `manganese-*` packages.
// Importing this module only installs its stylesheet.

import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import type { ApplicationsOptions } from "@domicile-desktop/manganese-launcher/applications-config";
import { applicationsConfigSchema } from "@domicile-desktop/manganese-launcher/applications-config";
import type { FloatingOptions } from "@domicile-desktop/manganese-window-management/floating/floating-rules";
import { floatingRulesSchema } from "@domicile-desktop/manganese-window-management/floating/floating-rules";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";
import { mountManganese } from "./mount-manganese";

import "./global.css";

export { DEFAULT_BAR } from "./default-bars";
/** Read by the builder into `options.json`, for the Settings app. */
export { options } from "./options";

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
   * `@domicile-desktop/manganese-window-management`'s
   * `docs/WINDOW-MANAGEMENT.md`.
   */
  readonly floating?: FloatingOptions;
  /**
   * Shell keybindings, below any the config binds. Defaults to
   * `DEFAULT_KEYBINDINGS` (sway's, on Meta).
   */
  readonly keybindings?: ShellKeybindings;
};

/** Build a `Shell` that mounts manganese with `options`. */
export const runManganese = (options: ManganeseOptions = {}): ShellModule => {
  // Parsed when the config is built, so a bad bookmark or pattern fails it.
  const applications = applicationsConfigSchema.parse(options.applications);
  const floating = floatingRulesSchema.parse(options.floating);
  return (root, host) => {
    mountManganese(root, desktop(host), {
      ...options,
      applications,
      floating,
    });
  };
};

/** The default shell, loaded by `"shell": "@domicile-desktop/manganese"`. */
export const Shell: ShellModule = runManganese();
