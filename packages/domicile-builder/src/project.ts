// Finds an entry's project, lists the packages it lacks, and computes the
// build cache key.

import path from "node:path";

import { z } from "zod";

/** Whether a file exists. */
export type Exists = (file: string) => boolean;

/** The `package.json` fields used here; other fields pass through. */
const manifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

/** Parse a project's `package.json`. Throws if it is invalid. */
export const parseManifest = (text: string): Manifest =>
  manifestSchema.parse(JSON.parse(text));

/**
 * Packages always taken from Domicile's install, never the project's.
 *
 * Domicile's packages must match the running Domicile's protocol, and the
 * user's code and manganese must share one React.
 */
const FROM_DOMICILE = /^(@domicile-desktop\/.+|react|react-dom)$/;

/**
 * The directory whose `package.json` and `bun.lock` hold an entry's packages:
 * the nearest ancestor with a `package.json`, or else the entry's own
 * directory, where one is created.
 */
export const projectOf = (entry: string, exists: Exists): string => {
  const own = path.dirname(path.resolve(entry));
  return nearestProject(own, exists) ?? own;
};

/** `directory` or its nearest ancestor with a `package.json`, if any. */
const nearestProject = (
  directory: string,
  exists: Exists,
): string | undefined => {
  const parent = path.dirname(directory);
  if (exists(path.join(directory, "package.json"))) {
    return directory;
  } else if (parent === directory) {
    return undefined;
  } else {
    return nearestProject(parent, exists);
  }
};

/** Packages in `imported` that `manifest` lacks, except Domicile's, sorted. */
export const missingPackages = (
  imported: ReadonlySet<string>,
  manifest: Manifest | undefined,
): readonly string[] =>
  [...imported]
    .filter(
      (name) =>
        !FROM_DOMICILE.test(name) &&
        !Object.hasOwn(manifest?.dependencies ?? {}, name),
    )
    .sort();

/**
 * The build cache key: a hash of the user's files, the lockfile and the
 * Domicile install path.
 */
export const cacheKey = (
  files: ReadonlyMap<string, string>,
  lockfile: string,
  domicile: string,
): string => {
  const hash = new Bun.CryptoHasher("sha256");
  for (const [file, text] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash.update(`${file}\0${text}\0`);
  }
  hash.update(`${lockfile}\0${domicile}`);
  return hash.digest("hex");
};
