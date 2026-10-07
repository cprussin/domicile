// Mounts manganese's React chrome on the desktop `runManganese`'s `Shell` is
// handed.

import {
  applyTheme,
  DEFAULT_THEME,
} from "@domicile-desktop/component-library/theme-core";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

import type { ApplicationsConfig } from "./launcher/applications-config";
import { mountPoint } from "./mount-point";
import { Shell as Chrome } from "./Shell";
import { hostDisplays } from "./screens/host-displays";
import { hostTheme } from "./theme/host-theme";
import { rememberedTheme } from "./theme/remembered-theme";
import type { TopBarLayout } from "./top-bar/layout";

/** What `mountManganese` draws, from `runManganese`'s parsed options. */
type MountOptions = {
  readonly applications: ApplicationsConfig;
  readonly keybindings?: ShellKeybindings | undefined;
  readonly topBar?: TopBarLayout | undefined;
};

/** Mount manganese into `root`. Returns the React root it rendered. */
export const mountManganese = (
  root: HTMLElement,
  domicile: DomicileHost,
  options: MountOptions,
): Root => {
  // Apply the last-seen theme before React mounts to avoid a theme flash on
  // first paint (the stylesheet ships in `index.tsx`; see
  // `@domicile-desktop/component-library/vite-shell`). The compositor owns the
  // theme (`theme.mode`), which corrects this guess. Defaults to dark,
  // matching `theme.mode`'s default.
  applyTheme(rememberedTheme() ?? DEFAULT_THEME);

  // Built once here, not per render, because a source holds the connection.
  const displays = hostDisplays(domicile);
  const theme = hostTheme(domicile);

  const reactRoot = createRoot(mountPoint(root));
  reactRoot.render(
    <Chrome
      applications={options.applications}
      displays={displays}
      domicile={domicile}
      keybindings={options.keybindings}
      theme={theme}
      topBar={options.topBar}
    />,
  );
  return reactRoot;
};
