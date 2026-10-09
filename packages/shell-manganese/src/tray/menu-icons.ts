// Tray menu entries' `icon-name`s, resolved in the config's icon theme.

import type { Result } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { ThemedIconLookup } from "@domicile-desktop/system-apps/app-icons";
import { themedIcons } from "@domicile-desktop/system-apps/app-icons";
import { dataDirs } from "@domicile-desktop/system-apps/data-dirs";

import type { IconTheme } from "../followed-icon-theme";
import { sharedIconTheme } from "../followed-icon-theme";

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
  menuIcons(system(domicile), sharedIconTheme(domicile));

/** A lookup of menu icons in the desktop's data directories, in `iconTheme`. */
export const menuIcons = async (
  host: System,
  iconTheme: IconTheme,
): Promise<Result<ThemedIconLookup, SystemError>> => {
  const theme = await iconTheme();
  return (await dataDirs(host)).map((dirs) =>
    themedIcons(host, dirs, CONTEXTS, { size: SIZE, theme }),
  );
};
