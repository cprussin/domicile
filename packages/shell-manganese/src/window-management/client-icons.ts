// Client windows' icons: the icon their desktop entry names, in the config's
// icon theme.

import type { Result } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { IconLookup } from "@domicile-desktop/system-apps/app-icons";
import { appIcons } from "@domicile-desktop/system-apps/app-icons";
import { dataDirs } from "@domicile-desktop/system-apps/data-dirs";
import type { DesktopEntry } from "@domicile-desktop/system-apps/desktop-entry";
import { installedApps } from "@domicile-desktop/system-apps/installed";

import type { IconTheme } from "../followed-icon-theme";
import { sharedIconTheme } from "../followed-icon-theme";

/** A title bar's icon slot, in CSS pixels. */
const SIZE = 16;

/**
 * A lookup of a desktop's client icons, by desktop id (the client's Wayland
 * app id). Reads the installed entries once; make another to see new ones.
 */
export type ClientIcons = (
  domicile: DomicileHost,
) => Promise<Result<IconLookup, SystemError>>;

/** {@link clientIcons} on `domicile`, in the theme its shell follows. */
export const desktopClientIcons: ClientIcons = (domicile) =>
  clientIcons(system(domicile), sharedIconTheme(domicile));

/**
 * A lookup of client icons in the desktop's data directories, in `iconTheme`.
 *
 * Draws the icon of the entry the desktop id names, matched in any case, since
 * some clients' app ids differ from their entry's name in case. A client with
 * no entry gets the icon named after its desktop id, which many apps install.
 */
export const clientIcons = async (
  host: System,
  iconTheme: IconTheme,
): Promise<Result<IconLookup, SystemError>> => {
  const theme = await iconTheme();
  return (await dataDirs(host)).andThenAsync(async (dirs) => {
    const icons = appIcons(host, dirs, ["apps"], { size: SIZE, theme });
    return (await installedApps(host, dirs)).map((installed) => {
      const entries = new Map(
        installed.map((entry) => [desktopIdOf(entry), entry]),
      );
      return (desktopId) =>
        icons(entries.get(desktopId.toLowerCase())?.icon ?? desktopId);
    });
  });
};

/** An entry's desktop id, lower cased for matching. */
const desktopIdOf = (entry: DesktopEntry): string =>
  entry.id.replace(/\.desktop$/, "").toLowerCase();
