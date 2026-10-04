import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import type { DisplaySource } from "@domicile-desktop/component-library/display-source";
import { Provider } from "@domicile-desktop/component-library/Provider";
import type { ThemeSource } from "@domicile-desktop/component-library/theme-source";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";

import { Desktop } from "./Desktop";
import { DEFAULT_KEYBINDINGS, DEFAULT_MODES } from "./keyboard/commands";
import type { TopBarLayout } from "./top-bar/layout";
import { DEFAULT_TOP_BAR } from "./top-bar/layout";

type Props = {
  /**
   * Where the desktop comes from: the host. Passed in rather than built here
   * because a source is the connection: the provider re-registers whenever
   * its identity changes, so one built per render would re-register per
   * render.
   */
  displays: DisplaySource;
  domicile: DomicileHost;
  /**
   * The keys this desktop binds itself, under the config's: sway's, on Meta,
   * when not given.
   */
  keybindings?: ShellKeybindings | undefined;
  /**
   * Where the theme comes from, and what the bar's toggle asks. The host over
   * the control channel — passed in
   * for {@link displays}'s reason, and for one more: the theme is the
   * desktop's, so a shell that built its own would be the one place that
   * changed.
   */
  theme: ThemeSource;
  /** What goes on every monitor's bar: manganese's own when not given. */
  topBar?: TopBarLayout | undefined;
};

/**
 * The reference chrome over the desktop the host described.
 *
 * The page spans every display, so this is the composition root in the literal
 * sense as well: it holds the one {@link DisplayProvider} the whole tree reads
 * its screens from: one listener for the host's descriptions, and every
 * `<Screen>` below fans out from it.
 */
export const Shell = ({
  displays,
  domicile,
  keybindings = DEFAULT_SHELL_KEYBINDINGS,
  theme,
  topBar = DEFAULT_TOP_BAR,
}: Props) => (
  <Provider theme={theme}>
    <DisplayProvider source={displays}>
      <Desktop domicile={domicile} keybindings={keybindings} topBar={topBar} />
    </DisplayProvider>
  </Provider>
);

/** Manganese's own keys: one value, so the binding is made once. */
const DEFAULT_SHELL_KEYBINDINGS: ShellKeybindings = {
  keybindings: DEFAULT_KEYBINDINGS,
  modes: DEFAULT_MODES,
};
