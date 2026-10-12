// Client windows' icons: the icon their desktop entry names, in the config's
// icon theme.

import type { Option, Result } from "@cprussin/option-result";
import { None, Ok } from "@cprussin/option-result";
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
 * Draws the first icon found of: the entry the desktop id names, the entries
 * whose `StartupWMClass` is the desktop id, and the icon named after the
 * desktop id, which many apps install. Ids and classes match in any case,
 * since some clients' app ids differ from their entry's name in case.
 */
export const clientIcons = async (
  host: System,
  iconTheme: IconTheme,
): Promise<Result<IconLookup, SystemError>> => {
  const theme = await iconTheme();
  return (await dataDirs(host)).andThenAsync(async (dirs) => {
    const icons = appIcons(host, dirs, ["apps"], { size: SIZE, theme });
    return (await installedApps(host, dirs)).map((installed) => {
      return (desktopId) => {
        const id = desktopId.toLowerCase();
        return firstFound(icons, [
          ...installed
            .filter((entry) => desktopIdOf(entry) === id)
            .map(({ icon }) => icon),
          ...installed
            .filter((entry) => entry.windowClass?.toLowerCase() === id)
            .map(({ icon }) => icon),
          desktopId,
        ]);
      };
    });
  });
};

/** The first of `names` with an icon; a failed read stops the search. */
const firstFound = async (
  icons: IconLookup,
  names: readonly (string | undefined)[],
): Promise<Result<Option<string>, SystemError>> => {
  for (const name of names) {
    if (name !== undefined) {
      const found = await icons(name);
      if (found.mapOr(true, (icon) => icon.isSome())) {
        return found;
      }
    }
  }
  return Ok(None());
};

/** An entry's desktop id, lower cased for matching. */
const desktopIdOf = (entry: DesktopEntry): string =>
  entry.id.replace(/\.desktop$/, "").toLowerCase();
