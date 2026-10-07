// The default applications `mimeapps.list` names for a content type. See
// https://specifications.freedesktop.org/mime-apps-spec/latest/.

import type { Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

import { desktopEnvironment, setVariable } from "./environment";
import { allOk, orAbsent } from "./results";

/** The group defaults are read from. */
const GROUP = "[Default Applications]";

/**
 * The desktop file IDs, `.desktop` included, set as `contentType`'s default,
 * most preferred first. The caller takes the first it can offer.
 *
 * Reads every `mimeapps.list` the spec names, the current desktop's own
 * (`domicile-mimeapps.list`) before each plain one. Missing lists are
 * skipped.
 */
export const defaultApps = async (
  system: System,
  contentType: string,
): Promise<Result<string[], SystemError>> =>
  (await desktopEnvironment(system)).andThenAsync(async (variables) =>
    allOk(
      await Promise.all(
        listPaths(variables).map(async (path) =>
          orAbsent(await system.readTextFile(path), "").map((text) =>
            defaultsIn(text, contentType),
          ),
        ),
      ),
    ).map((found) => found.flat()),
  );

/** Every list to read, in the spec's order. */
const listPaths = (variables: ReadonlyMap<string, string>): string[] => {
  const desktops = (setVariable(variables, "XDG_CURRENT_DESKTOP") ?? "")
    .split(":")
    .filter((desktop) => desktop !== "")
    .map((desktop) => desktop.toLowerCase());
  const names = [
    ...desktops.map((desktop) => `${desktop}-mimeapps.list`),
    "mimeapps.list",
  ];
  const dataDirs = [
    setVariable(variables, "XDG_DATA_HOME") ?? ".local/share",
    ...(
      setVariable(variables, "XDG_DATA_DIRS") ?? "/usr/local/share:/usr/share"
    ).split(":"),
  ].map((dir) => `${dir}/applications`);
  return [
    setVariable(variables, "XDG_CONFIG_HOME") ?? ".config",
    ...(setVariable(variables, "XDG_CONFIG_DIRS") ?? "/etc/xdg").split(":"),
    ...dataDirs,
  ].flatMap((dir) => names.map((name) => `${dir}/${name}`));
};

/** The IDs list `text` sets for `contentType`. */
const defaultsIn = (text: string, contentType: string): string[] => {
  let group = "";
  const found: string[] = [];
  for (const line of text.split("\n").map((each) => each.trim())) {
    if (line.startsWith("[")) {
      group = line;
    } else if (group === GROUP && !line.startsWith("#")) {
      const equals = line.indexOf("=");
      if (equals !== -1 && line.slice(0, equals).trim() === contentType) {
        found.push(
          ...line
            .slice(equals + 1)
            .split(";")
            .map((id) => id.trim())
            .filter((id) => id !== ""),
        );
      }
    }
  }
  return found;
};
