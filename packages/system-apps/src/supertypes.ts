// A content type's supertypes, from shared-mime-info's `mime/subclasses`. See
// https://specifications.freedesktop.org/shared-mime-info-spec/latest/.

import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { AppsDesktop } from "./apps-desktop";

import { allOk, orAbsent } from "./results";

/** The type the spec makes every other text/* type a subclass of. */
const TEXT = "text/plain";

/** One `subclasses` line: a type and one of its parents. */
type Subclass = { type: string; parent: string };

/**
 * `contentType`'s supertypes, nearest first, without `contentType` itself.
 *
 * Reads `mime/subclasses` under each of `dataDirs`, missing ones skipped, and
 * follows each parent to its own. Every text/* type is also a text/plain.
 */
export const supertypesOf = async (
  domicile: AppsDesktop,
  dataDirs: readonly string[],
  contentType: string,
): Promise<Result<string[], SystemError>> =>
  allOk(
    await Promise.all(
      dataDirs.map(async (dir) =>
        orAbsent(
          await domicile.files.readText(`${dir}/mime/subclasses`),
          "",
        ).map(subclassesIn),
      ),
    ),
  ).map((subclasses) =>
    ancestorsOf(subclasses.flat(), [contentType], [contentType]).slice(1),
  );

/** `seen`, then the parents of `level`'s types, then theirs, each once. */
const ancestorsOf = (
  subclasses: readonly Subclass[],
  level: readonly string[],
  seen: readonly string[],
): readonly string[] => {
  const parents = [
    ...new Set(level.flatMap((type) => parentsOf(subclasses, type))),
  ].filter((type) => !seen.includes(type));
  return parents.length === 0
    ? seen
    : ancestorsOf(subclasses, parents, [...seen, ...parents]);
};

/** `type`'s own parents: those `subclasses` lists, then text/plain for text. */
const parentsOf = (subclasses: readonly Subclass[], type: string): string[] => [
  ...subclasses
    .filter((subclass) => subclass.type === type)
    .map(({ parent }) => parent),
  ...(type.startsWith("text/") && type !== TEXT ? [TEXT] : []),
];

/** The pairs `text` lists: `type parent`. */
const subclassesIn = (text: string): Subclass[] =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [type = "", parent = ""] = line.split(" ");
      return { parent, type };
    });
