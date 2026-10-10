// Applications named and drawn by their desktop entries, for a shell to show
// who asks for something.

import type { Option } from "@cprussin/option-result";
import { None, Ok, Result } from "@cprussin/option-result";
import { readIconTheme } from "@domicile-desktop/sdk/icon-theme";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

import type { IconLookup } from "./app-icons";
import { appIcons } from "./app-icons";
import { dataDirs } from "./data-dirs";
import type { DesktopEntry } from "./desktop-entry";
import { installedApps } from "./installed";

/** An application, as its desktop entry describes it. */
export type DescribedApp = {
  /** Its desktop file ID without `.desktop`, as portals and windows name it. */
  id: string;
  /** Its entry's `Name`, or `id` when it has no entry. */
  name: string;
  /** A `data:` URL, or `undefined` for none. */
  icon: string | undefined;
};

/**
 * Each of `ids`, in order, described by its installed desktop entry, with its
 * icon from the config's icon theme.
 */
export const describeApps = async (
  system: System,
  ids: readonly string[],
): Promise<Result<DescribedApp[], SystemError>> => {
  const [dirs, theme] = await Promise.all([
    dataDirs(system),
    readIconTheme(system),
  ]);
  return dirs.andThenAsync((found) =>
    theme.andThenAsync((named) =>
      describedIn(
        system,
        found,
        appIcons(system, found, ["apps"], {
          theme: named.match({ None: () => undefined, Some: (name) => name }),
        }),
        ids,
      ),
    ),
  );
};

/** Each of `ids` described by its entry under `dirs`, drawn by `icons`. */
const describedIn = async (
  system: System,
  dirs: readonly string[],
  icons: IconLookup,
  ids: readonly string[],
): Promise<Result<DescribedApp[], SystemError>> =>
  (await installedApps(system, dirs)).andThenAsync(async (installed) => {
    const entries = new Map(
      installed.map((entry) => [entry.id.replace(/\.desktop$/, ""), entry]),
    );
    return Result.collect(
      await Promise.all(ids.map((id) => described(icons, id, entries.get(id)))),
    );
  });

/** App `id`, named and drawn by its `entry` when it has one. */
const described = async (
  icons: IconLookup,
  id: string,
  entry: DesktopEntry | undefined,
): Promise<Result<DescribedApp, SystemError>> =>
  entry === undefined
    ? Ok({ icon: undefined, id, name: id })
    : (entry.icon === undefined
        ? Ok<Option<string>, SystemError>(None())
        : await icons(entry.icon)
      ).map((icon) => ({
        icon: icon.match({ None: () => undefined, Some: (url) => url }),
        id,
        name: entry.name,
      }));
