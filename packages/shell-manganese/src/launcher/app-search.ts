// The launcher's applications and bookmarks, read through the desktop's system
// calls by `@domicile-desktop/system-apps`.

import type { Option, Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import type { IconLookup } from "@domicile-desktop/system-apps/app-icons";
import { appIcons } from "@domicile-desktop/system-apps/app-icons";
import { findBookmarks } from "@domicile-desktop/system-apps/bookmark";
import { curlFetch } from "@domicile-desktop/system-apps/curl";
import { dataDirs } from "@domicile-desktop/system-apps/data-dirs";
import type { DesktopEntry as InstalledEntry } from "@domicile-desktop/system-apps/desktop-entry";
import { favicon } from "@domicile-desktop/system-apps/favicon";
import type { Favicons } from "@domicile-desktop/system-apps/favicons";
import { favicons } from "@domicile-desktop/system-apps/favicons";
import { findApps } from "@domicile-desktop/system-apps/find-apps";
import { installedApps } from "@domicile-desktop/system-apps/installed";
import { omitting } from "@domicile-desktop/system-apps/omit";

import type { ApplicationsConfig } from "./applications-config";
import type { Bookmark, DesktopEntry, FoundApps } from "./found-apps";

/** Most applications, and most bookmarks, offered for one query. */
const FOUND = 50;

export type AppSearch = {
  /** Reads what is installed again, then offers the empty box's rows. */
  opening: () => Promise<FoundApps>;
  /** What matches `query`, from what was read on the last opening. */
  search: (query: string) => Promise<FoundApps>;
};

/** What is installed, as read on an opening. */
type Installed = { entries: InstalledEntry[]; icon: IconLookup };

/**
 * Searches the applications installed on the desktop `system` reaches, less
 * those `config` omits, and `config`'s bookmarks.
 *
 * Reads desktop entries on {@link AppSearch.opening} only: a read is a system
 * call per file, too slow for every keystroke. Bookmark icons are fetched in
 * the background, so a later search has them.
 */
export const appSearch = (
  system: System,
  config: ApplicationsConfig,
  icons: Favicons = favicons((url) => favicon(url, curlFetch(system))),
): AppSearch => {
  const omits = omitting(config.omit);
  let installed: Promise<Installed> | undefined;
  const search = async (query: string): Promise<FoundApps> => {
    icons
      .lookFor(config.bookmarks.map(({ url }) => url))
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: surfacing a lookup that broke
        console.error("could not look for bookmarks' icons", error);
      });
    installed ??= read(system, omits);
    const { entries, icon } = await installed;
    return {
      apps: await Promise.all(
        findApps(entries, query, FOUND).map((entry) => drawn(entry, icon)),
      ),
      bookmarks: findBookmarks(config.bookmarks, query, FOUND).map(
        (bookmark): Bookmark => ({
          ...bookmark,
          icon: orUndefined(icons.icon(bookmark.url)),
        }),
      ),
    };
  };
  return {
    opening: () => {
      installed = read(system, omits);
      return search("");
    },
    search,
  };
};

const read = async (
  system: System,
  omits: (id: string) => boolean,
): Promise<Installed> => {
  const dirs = succeeded(await dataDirs(system));
  return {
    entries: succeeded(await installedApps(system, dirs)).filter(
      ({ id }) => !omits(id),
    ),
    icon: appIcons(system, dirs),
  };
};

/** `entry` with its pictures read. */
const drawn = async (
  {
    command,
    comment,
    icon: iconName,
    id,
    name,
    preview: previewName,
  }: InstalledEntry,
  icon: IconLookup,
): Promise<DesktopEntry> => {
  const picture = async (named: string | undefined) =>
    named === undefined ? undefined : orUndefined(succeeded(await icon(named)));
  return {
    command,
    comment,
    icon: await picture(iconName),
    id,
    name,
    preview: await picture(previewName),
  };
};

/** The value, or a throw: a desktop that refuses to read fails the search. */
const succeeded = <T extends NonNullable<unknown>>(
  result: Result<T, SystemError>,
): T =>
  result.match({
    Err: (error) => {
      throw new Error(
        `could not read the installed applications: ${error.message}`,
      );
    },
    Ok: (value) => value,
  });

const orUndefined = <T extends NonNullable<unknown>>(
  option: Option<T>,
): T | undefined =>
  option.match({ None: () => undefined, Some: (value) => value });
