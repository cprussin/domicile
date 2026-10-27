import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import { Provider } from "@domicile-desktop/component-library/Provider";
import type { ThemeSource } from "@domicile-desktop/component-library/theme-source";
import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import type { ApplicationsConfig } from "@domicile-desktop/manganese-launcher/applications-config";
import type { Inbox } from "@domicile-desktop/manganese-notifications/inbox";
import type { FloatingRules } from "@domicile-desktop/manganese-window-management/floating/floating-rules";
import { DEFAULT_KEYBINDINGS } from "@domicile-desktop/manganese-window-management/keyboard/commands";
import { hostDisplays } from "@domicile-desktop/manganese-window-management/screens/host-displays";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { useMemo } from "react";
import { Desktop } from "./Desktop";
import { DEFAULT_BAR } from "./default-bars";

type Props = {
  /**
   * What the launcher offers beside files. Must be stable: a new one reads
   * the installed applications again.
   */
  applications: ApplicationsConfig;
  /** The layout of every monitor's bar. Defaults to manganese's. */
  bar?: BarLayout | undefined;
  /** Which client windows open floating, besides dialogs. Defaults to none. */
  floating?: FloatingRules | undefined;
  /** The inboxes listed in the notification drawer. Defaults to none. */
  inboxes?: readonly Inbox[] | undefined;
  /** The keys this desktop binds, under the config's. Defaults to sway's. */
  keybindings?: ShellKeybindings | undefined;
  /**
   * The source of the theme, and where the bar's toggle sends changes.
   *
   * Must be stable: the provider re-registers when its identity changes.
   */
  theme: ThemeSource;
};

/**
 * The reference shell chrome, on the desktop from `useDomicile`.
 *
 * Holds the single {@link DisplayProvider} every `<Screen>` reads from.
 */
export const Shell = ({
  applications,
  bar = DEFAULT_BAR,
  floating = NO_FLOATING_RULES,
  inboxes = NO_INBOXES,
  keybindings = DEFAULT_SHELL_KEYBINDINGS,
  theme,
}: Props) => {
  const domicile = useDomicile();
  // Once per desktop: the provider re-registers when the source changes.
  const displays = useMemo(() => hostDisplays(domicile), [domicile]);
  return (
    <Provider theme={theme}>
      <DisplayProvider source={displays}>
        <Desktop
          applications={applications}
          bar={bar}
          floating={floating}
          inboxes={inboxes}
          keybindings={keybindings}
        />
      </DisplayProvider>
    </Provider>
  );
};

/** No floating rules, defined once so the reference is stable. */
const NO_FLOATING_RULES: FloatingRules = [];

/** No inboxes, defined once so the reference is stable. */
const NO_INBOXES: readonly Inbox[] = [];

/** Manganese's default keybindings, defined once so the reference is stable. */
const DEFAULT_SHELL_KEYBINDINGS: ShellKeybindings = {
  keybindings: DEFAULT_KEYBINDINGS,
};
