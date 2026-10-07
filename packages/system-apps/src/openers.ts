// The applications that open a file, its default first, and the argv each
// opens it with.

import type { Option, Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

import { contentTypeOf } from "./content-type";
import { dataDirs } from "./data-dirs";
import type { DesktopEntry } from "./desktop-entry";
import { desktopEnvironment, setVariable } from "./environment";
import { commandOf } from "./exec";
import { installedApps } from "./installed";
import { defaultApps } from "./mime-apps";

/** What can open a file. */
export type Openers = {
  /** The file's content type, by name. Nothing when no glob matches. */
  contentType: Option<string>;
  /**
   * The installed applications for the type: its defaults from
   * `mimeapps.list` in their order (see `./mime-apps`), then the rest whose
   * `MimeType` lists it, by name. The first is the one to open it with.
   */
  apps: DesktopEntry[];
  /** The argv that opens the file with `app`. */
  command: (app: DesktopEntry) => string[];
};

/**
 * What can open `path`: relative to home, as every system call's path is, or
 * absolute.
 *
 * Only `MimeType` and the defaults are read: aliases, subclasses and
 * `mimeapps.list`'s added and removed associations are not. A launcher falls
 * back to `xdg-open` when this offers nothing.
 */
export const openers = async (
  system: System,
  path: string,
): Promise<Result<Openers, SystemError>> =>
  (await desktopEnvironment(system)).andThenAsync(async (variables) => {
    const file = path.startsWith("/") ? path : `${homeOf(variables)}/${path}`;
    return (await dataDirs(system)).andThenAsync(async (dirs) =>
      (await contentTypeOf(system, dirs, path)).andThenAsync(
        async (contentType) =>
          (
            await contentType.match({
              None: () => Promise.resolve(Ok<DesktopEntry[], SystemError>([])),
              Some: (type) => appsFor(system, dirs, type),
            })
          ).map((apps) => ({
            apps,
            command: (app: DesktopEntry) => commandFor(app, file),
            contentType,
          })),
      ),
    );
  });

/** The installed applications for `contentType`, in `Openers.apps`'s order. */
const appsFor = async (
  system: System,
  dirs: readonly string[],
  contentType: string,
): Promise<Result<DesktopEntry[], SystemError>> =>
  (await installedApps(system, dirs)).andThenAsync(async (installed) =>
    (await defaultApps(system, contentType)).map((defaults) => {
      const byId = new Map(installed.map((app) => [app.id, app]));
      const first = [...new Set(defaults)].flatMap((id) => {
        const app = byId.get(id);
        return app === undefined ? [] : [app];
      });
      const rest = installed
        .filter(
          (app) => app.mimeTypes.includes(contentType) && !first.includes(app),
        )
        .toSorted((a, b) => a.name.localeCompare(b.name));
      return [...first, ...rest];
    }),
  );

const homeOf = (variables: ReadonlyMap<string, string>): string => {
  const home = setVariable(variables, "HOME");
  if (home === undefined) {
    throw new Error("the desktop has no HOME to open a file under");
  } else {
    return home;
  }
};

/** `app`'s argv for `file`. It was read once already, so it reads again. */
const commandFor = (app: DesktopEntry, file: string): string[] =>
  commandOf(app.exec, file).match({
    None: () => {
      throw new Error(`${app.id}'s Exec could not be read again`);
    },
    Some: (command) => command,
  });
