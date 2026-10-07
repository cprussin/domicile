// A desktop entry file read into a launchable application. See
// https://specifications.freedesktop.org/desktop-entry-spec/latest/.

import type { Option } from "@cprussin/option-result";
import { None } from "@cprussin/option-result";

import { unescaped } from "./escapes";
import { commandOf } from "./exec";

/** The only group keys are read from. */
const GROUP = "[Desktop Entry]";

/** An application a desktop entry offers. */
export type DesktopEntry = {
  /** The desktop file ID: its path under `applications/`, `/` read as `-`. */
  id: string;
  name: string;
  /** Empty for an entry with no `Comment`. */
  comment: string;
  /** The argv it runs. */
  command: readonly string[];
  /** `Exec` as written, for `commandOf` to open a file with. */
  exec: string;
  /** `MimeType`: the content types it opens. */
  mimeTypes: readonly string[];
  /** `Name`, `GenericName` and `Keywords`, in lower case, for `findApps`. */
  words: string;
  /** `Icon`: a theme name or an absolute path. See `./app-icons`. */
  icon: string | undefined;
  /** `X-Domicile-Preview`, in the same form as `icon`. */
  preview: string | undefined;
};

/**
 * Entry `text` as `id`, or nothing if a launcher should not offer it.
 *
 * Reads only unlocalized keys in `[Desktop Entry]`. Rejects non-applications,
 * `Hidden` or `NoDisplay` entries, entries without a `Name` or a readable
 * `Exec`, and `Terminal` entries, since no terminal is configured.
 */
export const parseDesktopEntry = (
  id: string,
  text: string,
): Option<DesktopEntry> => {
  const keys = keysOf(text);
  const flag = (key: string) => keys.get(key) === "true";
  const name = keys.get("Name");
  const exec = keys.get("Exec");
  return keys.get("Type") !== "Application" ||
    flag("Hidden") ||
    flag("NoDisplay") ||
    flag("Terminal") ||
    name === undefined ||
    exec === undefined
    ? None()
    : commandOf(exec).map((command) => ({
        command,
        comment: unescaped(keys.get("Comment") ?? ""),
        exec,
        icon: optional(keys.get("Icon")),
        id,
        mimeTypes: (keys.get("MimeType") ?? "")
          .split(";")
          .filter((type) => type !== ""),
        name: unescaped(name),
        preview: optional(keys.get("X-Domicile-Preview")),
        words: [name, keys.get("GenericName") ?? "", keys.get("Keywords") ?? ""]
          .map(unescaped)
          .join("\n")
          .toLowerCase(),
      }));
};

/** The `[Desktop Entry]` group's keys; the first of a repeated key wins. */
const keysOf = (text: string): ReadonlyMap<string, string> => {
  const keys = new Map<string, string>();
  let group = "";
  for (const line of text.split("\n").map((each) => each.trim())) {
    if (line.startsWith("[")) {
      group = line;
    } else if (group === GROUP && !line.startsWith("#")) {
      const equals = line.indexOf("=");
      const key = line.slice(0, equals).trim();
      if (equals !== -1 && !keys.has(key)) {
        keys.set(key, line.slice(equals + 1).trim());
      }
    }
  }
  return keys;
};

const optional = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : unescaped(value);
