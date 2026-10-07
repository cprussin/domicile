// A file's content type, by name, from shared-mime-info's `mime/globs2`. See
// https://specifications.freedesktop.org/shared-mime-info-spec/latest/.

import type { Option, Result } from "@cprussin/option-result";
import { None, Ok, Some } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import { FileType } from "@domicile-desktop/sdk/system";

import { globOf } from "./glob";
import { allOk, orAbsent } from "./results";

/** The type shared-mime-info gives every directory. */
const DIRECTORY = "inode/directory";

/** One `globs2` line. */
type Glob = { weight: number; type: string; pattern: string; glob: RegExp };

/**
 * `path`'s content type, or nothing when no glob matches its name.
 *
 * Matches the name only; contents are not sniffed. Reads `mime/globs2` under
 * each of `dataDirs`, missing ones skipped. The heaviest match wins, then the
 * longest pattern, then the earliest directory.
 */
export const contentTypeOf = async (
  system: System,
  dataDirs: readonly string[],
  path: string,
): Promise<Result<Option<string>, SystemError>> =>
  (await system.stat(path)).andThenAsync(async ({ fileType }) =>
    fileType === FileType.Directory
      ? Ok<Option<string>, SystemError>(Some(DIRECTORY))
      : allOk(
          await Promise.all(
            dataDirs.map(async (dir) =>
              orAbsent(await system.readTextFile(`${dir}/mime/globs2`), "").map(
                globsIn,
              ),
            ),
          ),
        ).map((globs) => matching(globs.flat(), nameOf(path))),
  );

/** The type of the best glob matching `name`. */
const matching = (globs: readonly Glob[], name: string): Option<string> => {
  const best = globs
    .filter(({ glob }) => glob.test(name))
    .toSorted(
      (a, b) => b.weight - a.weight || b.pattern.length - a.pattern.length,
    )[0];
  return best === undefined ? None() : Some(best.type);
};

/** The globs `text` lists: `weight:type:glob[:flags]`. */
const globsIn = (text: string): Glob[] =>
  text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [weight = "", type = "", pattern = "", flags = ""] =
        line.split(":");
      const glob = globOf(pattern);
      return {
        glob: flags.split(",").includes("cs")
          ? glob
          : new RegExp(glob.source, `${glob.flags}i`),
        pattern,
        type,
        weight: Number(weight),
      };
    });

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
