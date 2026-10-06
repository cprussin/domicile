import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import type { DisplaySource } from "@domicile-desktop/component-library/display-source";
import { Provider } from "@domicile-desktop/component-library/Provider";
import type { ThemeSource } from "@domicile-desktop/component-library/theme-source";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";

import { Desktop } from "./Desktop";
import { DEFAULT_KEYBINDINGS, DEFAULT_MODES } from "./keyboard/commands";
import type { ApplicationsConfig } from "./launcher/applications-config";
import type { TopBarLayout } from "./top-bar/layout";
import { DEFAULT_TOP_BAR } from "./top-bar/layout";

type Props = {
  /**
   * What the launcher offers beside files. Must be stable: a new one reads
   * the installed applications again.
   */
  applications: ApplicationsConfig;
  /**
   * The source of display descriptions.
   *
   * Must be stable: the provider re-registers when its identity changes.
   */
  displays: DisplaySource;
  domicile: DomicileHost;
  /** The keys this desktop binds, under the config's. Defaults to sway's. */
  keybindings?: ShellKeybindings | undefined;
  /**
   * The source of the theme, and where the bar's toggle sends changes. Passed
   * in, like {@link displays}, so the shell uses the desktop's theme.
   */
  theme: ThemeSource;
  /** The layout of every monitor's bar. Defaults to manganese's. */
  topBar?: TopBarLayout | undefined;
};

/**
 * The reference shell chrome.
 *
 * Holds the single {@link DisplayProvider} every `<Screen>` reads from.
 */
export const Shell = ({
  applications,
  displays,
  domicile,
  keybindings = DEFAULT_SHELL_KEYBINDINGS,
  theme,
  topBar = DEFAULT_TOP_BAR,
}: Props) => (
  <Provider theme={theme}>
    <DisplayProvider source={displays}>
      <Desktop
        applications={applications}
        domicile={domicile}
        keybindings={keybindings}
        topBar={topBar}
      />
    </DisplayProvider>
  </Provider>
);

/** Manganese's default keybindings, defined once so the reference is stable. */
const DEFAULT_SHELL_KEYBINDINGS: ShellKeybindings = {
  keybindings: DEFAULT_KEYBINDINGS,
  modes: DEFAULT_MODES,
};
