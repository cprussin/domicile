// The applications an app chooser offers, described from their desktop
// entries, and which to pick first.

import type { Option } from "@cprussin/option-result";
import { None, Ok, Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import type { IconLookup } from "@domicile-desktop/system-apps/app-icons";
import { appIcons } from "@domicile-desktop/system-apps/app-icons";
import { dataDirs } from "@domicile-desktop/system-apps/data-dirs";
import type { DesktopEntry } from "@domicile-desktop/system-apps/desktop-entry";
import { installedApps } from "@domicile-desktop/system-apps/installed";
import { defaultApps } from "@domicile-desktop/system-apps/mime-apps";

/** One application offered. */
export type AppChoice = {
  /** Its desktop file ID without `.desktop`, as the portal names it. */
  id: string;
  /** Its entry's `Name`, or `id` when it has no entry to read. */
  name: string;
  /** A `data:` URL, or `undefined` for none. */
  icon: string | undefined;
};

/** The offered applications, described, and the defaults for the type. */
export type DescribedChoices = {
  apps: AppChoice[];
  /** `mimeapps.list`'s defaults, desktop file IDs without `.desktop`. */
  defaults: string[];
};

/**
 * Describe `choices`, in their order, and read `contentType`'s defaults: none
 * when it is `undefined`.
 */
export const describeChoices = async (
  system: System,
  choices: readonly string[],
  contentType: string | undefined,
): Promise<Result<DescribedChoices, SystemError>> =>
  (await dataDirs(system)).andThenAsync(async (dirs) => {
    const icons = appIcons(system, dirs);
    const apps = (await installedApps(system, dirs)).andThenAsync(
      async (installed) => {
        const entries = new Map(
          installed.map((entry) => [withoutSuffix(entry.id), entry]),
        );
        return Result.collect(
          await Promise.all(
            choices.map((id) => described(icons, id, entries.get(id))),
          ),
        );
      },
    );
    const defaults =
      contentType === undefined
        ? Ok<string[], SystemError>([])
        : await defaultApps(system, contentType);
    return (await apps).andThen((found) =>
      defaults.map((ids) => ({
        apps: found,
        defaults: ids.map(withoutSuffix),
      })),
    );
  });

/**
 * The application to pick first: the last one chosen, else the first default
 * offered, else the first offered.
 */
export const preselected = (
  choices: readonly string[],
  lastChoice: string | undefined,
  defaults: readonly string[],
): string | undefined =>
  [lastChoice, ...defaults, choices[0]].find(
    (id) => id !== undefined && choices.includes(id),
  );

/** Choice `id`, named and drawn by its `entry` when it has one. */
const described = async (
  icons: IconLookup,
  id: string,
  entry: DesktopEntry | undefined,
): Promise<Result<AppChoice, SystemError>> =>
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

const withoutSuffix = (id: string): string => id.replace(/\.desktop$/, "");
