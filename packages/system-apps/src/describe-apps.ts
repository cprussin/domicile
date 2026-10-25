// Applications named and drawn by their desktop entries, for a shell to show
// who asks for something.

import type { Option } from "@cprussin/option-result";
import { None, Ok, Result } from "@cprussin/option-result";
import { readIconTheme } from "@domicile-desktop/sdk/icon-theme";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { IconLookup } from "./app-icons";
import { appIcons } from "./app-icons";
import { appIdName } from "./app-id-name";
import type { AppsDesktop } from "./apps-desktop";
import { dataDirs } from "./data-dirs";
import type { DesktopEntry } from "./desktop-entry";
import { installedApps } from "./installed";

/** An application, as its desktop entry describes it. */
export type DescribedApp = {
  /** Its desktop file ID without `.desktop`, as portals and windows name it. */
  id: string;
  /** Its entry's `Name`, or `id` made readable when it has no entry. */
  name: string;
  /** A `data:` URL, or `undefined` for none. */
  icon: string | undefined;
};

/**
 * Each of `ids`, in order, described by its installed desktop entry, with its
 * icon from the config's icon theme. See {@link entryFor} for how an id finds
 * its entry.
 */
export const describeApps = async (
  domicile: AppsDesktop,
  ids: readonly string[],
): Promise<Result<DescribedApp[], SystemError>> => {
  const [dirs, theme] = await Promise.all([
    dataDirs(domicile),
    readIconTheme(domicile),
  ]);
  return dirs.andThenAsync((found) =>
    theme.andThenAsync((named) =>
      describedIn(
        domicile,
        found,
        appIcons(domicile, found, ["apps"], {
          theme: named.match({ None: () => undefined, Some: (name) => name }),
        }),
        ids,
      ),
    ),
  );
};

/** Each of `ids` described by its entry under `dirs`, drawn by `icons`. */
const describedIn = async (
  domicile: AppsDesktop,
  dirs: readonly string[],
  icons: IconLookup,
  ids: readonly string[],
): Promise<Result<DescribedApp[], SystemError>> =>
  (await installedApps(domicile, dirs)).andThenAsync(async (installed) => {
    return Result.collect(
      await Promise.all(
        ids.map((id) => described(icons, id, entryFor(installed, id))),
      ),
    );
  });

/**
 * The entry whose desktop file ID is `id`. Failing that, the first whose ID,
 * `StartupWMClass` or `Name` is `id` or its last reverse-DNS part, ignoring
 * case: a portal can name an application by an id its entry does not use,
 * as `com.chromium.Chromium` for `chromium-browser.desktop`.
 */
const entryFor = (
  installed: readonly DesktopEntry[],
  id: string,
): DesktopEntry | undefined => {
  const wanted = new Set([
    id.toLowerCase(),
    (id.split(".").at(-1) ?? id).toLowerCase(),
  ]);
  return (
    installed.find((entry) => desktopIdOf(entry) === id) ??
    installed.find((entry) =>
      [desktopIdOf(entry), entry.windowClass ?? "", entry.name].some((name) =>
        wanted.has(name.toLowerCase()),
      ),
    )
  );
};

const desktopIdOf = (entry: DesktopEntry): string =>
  entry.id.replace(/\.desktop$/, "");

/** App `id`, named and drawn by its `entry` when it has one. */
const described = async (
  icons: IconLookup,
  id: string,
  entry: DesktopEntry | undefined,
): Promise<Result<DescribedApp, SystemError>> =>
  entry === undefined
    ? Ok({ icon: undefined, id, name: appIdName(id) })
    : (entry.icon === undefined
        ? Ok<Option<string>, SystemError>(None())
        : await icons(entry.icon)
      ).map((icon) => ({
        icon: icon.match({ None: () => undefined, Some: (url) => url }),
        id,
        name: entry.name,
      }));
