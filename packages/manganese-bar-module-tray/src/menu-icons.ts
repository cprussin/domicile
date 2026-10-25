// Tray menu entries' `icon-name`s, resolved in the config's icon theme.

import type { Result } from "@cprussin/option-result";
import type { IconTheme } from "@domicile-desktop/manganese-host/followed-icon-theme";
import { sharedIconTheme } from "@domicile-desktop/manganese-host/followed-icon-theme";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { ThemedIconLookup } from "@domicile-desktop/system-apps/app-icons";
import { themedIcons } from "@domicile-desktop/system-apps/app-icons";
import type { AppsDesktop } from "@domicile-desktop/system-apps/apps-desktop";
import { dataDirs } from "@domicile-desktop/system-apps/data-dirs";

/** The contexts menu icons are installed in. */
const CONTEXTS = ["actions", "status", "devices", "apps"];

/** The menu's icon slot, in CSS pixels. */
const SIZE = 16;

/** A lookup of a desktop's menu icons. */
export type MenuIcons = (
  domicile: DomicileHost,
) => Promise<Result<ThemedIconLookup, SystemError>>;

/** {@link menuIcons} on `domicile`, in the theme its shell follows. */
export const desktopMenuIcons: MenuIcons = (domicile) =>
  menuIcons(desktop(domicile), sharedIconTheme(domicile));

/** A lookup of menu icons in the desktop's data directories, in `iconTheme`. */
export const menuIcons = async (
  host: AppsDesktop,
  iconTheme: IconTheme,
): Promise<Result<ThemedIconLookup, SystemError>> => {
  const theme = await iconTheme();
  return (await dataDirs(host)).map((dirs) =>
    themedIcons(host, dirs, CONTEXTS, { size: SIZE, theme }),
  );
};
