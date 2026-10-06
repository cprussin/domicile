// Every application installed in the XDG data directories.

import type { Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import type {
  DirEntry,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { FileType } from "@domicile-desktop/sdk/system";

import type { DesktopEntry } from "./desktop-entry";
import { parseDesktopEntry } from "./desktop-entry";
import { allOk, orAbsent } from "./results";

/** A desktop file ID and the file it names. */
type EntryFile = { id: string; path: string };

/**
 * Every application in `applications/` under `dataDirs`, unordered.
 *
 * `dataDirs` is highest priority first (see `./data-dirs`). An ID in an
 * earlier directory hides the same ID in later ones, even when the earlier
 * entry is `Hidden`: that is how a user removes a system entry. Missing
 * directories and unreadable files are skipped.
 */
export const installedApps = async (
  system: System,
  dataDirs: readonly string[],
): Promise<Result<DesktopEntry[], SystemError>> => {
  const listed = allOk(
    await Promise.all(
      dataDirs.map((dir) => entryFiles(system, `${dir}/applications`, "")),
    ),
  );
  return (
    await listed.andThenAsync(async (dirs) =>
      allOk(
        await Promise.all(
          firstOfEach(dirs.flat()).map((file) => read(system, file)),
        ),
      ),
    )
  ).map((read) =>
    read.flatMap((entry) =>
      entry.match({ None: () => [], Some: (found) => [found] }),
    ),
  );
};

/** Each ID's first file, in priority order. */
const firstOfEach = (files: readonly EntryFile[]): EntryFile[] => {
  const seen = new Set<string>();
  return files.filter(({ id }) => {
    const first = !seen.has(id);
    seen.add(id);
    return first;
  });
};

/** `file` parsed, or nothing for an unreadable file or one not to offer. */
const read = async (system: System, { id, path }: EntryFile) =>
  orAbsent(
    (await system.readTextFile(path)).map((text) =>
      parseDesktopEntry(id, text),
    ),
    None<DesktopEntry>(),
  );

/**
 * Every `.desktop` file under `dir`, recursively, with its ID: `prefix` plus
 * its path under `dir`, `/` read as `-`.
 */
const entryFiles = async (
  system: System,
  dir: string,
  prefix: string,
): Promise<Result<EntryFile[], SystemError>> =>
  orAbsent(await system.readDir(dir), []).andThenAsync(async (entries) =>
    allOk(
      await Promise.all(
        entries.map((entry) => filesAt(system, dir, prefix, entry)),
      ),
    ).map((found) => found.flat()),
  );

/** The entry files `entry` in `dir` holds: itself, or those under it. */
const filesAt = async (
  system: System,
  dir: string,
  prefix: string,
  { fileType, name }: DirEntry,
): Promise<Result<EntryFile[], SystemError>> => {
  const path = `${dir}/${name}`;
  const below = () => entryFiles(system, path, `${prefix}${name}-`);
  if (fileType === FileType.Directory) {
    return below();
  } else if (name.endsWith(".desktop")) {
    return Ok([{ id: `${prefix}${name}`, path }]);
  } else if (fileType === FileType.Symlink) {
    return orAbsent(
      (await system.stat(path)).map(({ fileType: target }) =>
        target === FileType.Directory ? Some(target) : None<FileType>(),
      ),
      None<FileType>(),
    ).andThenAsync((linked) =>
      linked.isSome() ? below() : Promise.resolve(Ok([])),
    );
  } else {
    return Ok([]);
  }
};
