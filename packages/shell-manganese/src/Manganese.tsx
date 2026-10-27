// Manganese's chrome on the desktop from `useDomicile`, with the desktop's
// theme and look. `runManganese` mounts it.

import { applyAppearance } from "@domicile-desktop/component-library/appearance";
import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import type { ApplicationsConfig } from "@domicile-desktop/manganese-launcher/applications-config";
import type { Inbox } from "@domicile-desktop/manganese-notifications/inbox";
import type { FloatingRules } from "@domicile-desktop/manganese-window-management/floating/floating-rules";
import { useAppearance } from "@domicile-desktop/react/appearance";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { useLayoutEffect, useMemo } from "react";

import { Shell } from "./Shell";
import { hostTheme } from "./theme/host-theme";

type Props = {
  readonly applications: ApplicationsConfig;
  readonly bar?: BarLayout | undefined;
  readonly floating: FloatingRules;
  readonly inboxes?: readonly Inbox[] | undefined;
  readonly keybindings?: ShellKeybindings | undefined;
};

/** Manganese, from `runManganese`'s parsed options. */
export const Manganese = ({
  applications,
  bar,
  floating,
  inboxes,
  keybindings,
}: Props) => {
  const domicile = useDomicile();
  // Once per desktop: the theme provider re-registers when the source changes.
  const theme = useMemo(() => hostTheme(domicile), [domicile]);
  // The config's accent, contrast and motion, which the settings portal also
  // serves windows. Applied before the first paint.
  const appearance = useAppearance();
  useLayoutEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);
  return (
    <Shell
      applications={applications}
      bar={bar}
      floating={floating}
      inboxes={inboxes}
      keybindings={keybindings}
      theme={theme}
    />
  );
};
