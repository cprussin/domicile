// Where an entry's packages are installed, which it lacks, and when a build
// of it can be reused.

import path from "node:path";

import { z } from "zod";

/** Whether a file is there. */
export type Exists = (file: string) => boolean;

/** The parts of a `package.json` read here; the rest is the project's. */
const manifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

/** A project's `package.json`, parsed. Throws on one that is not one. */
export const parseManifest = (text: string): Manifest =>
  manifestSchema.parse(JSON.parse(text));

/**
 * The packages a build takes from Domicile's own install, never the
 * project's: Domicile's packages, so the shell speaks the protocol of the
 * Domicile running it, and React, so a hook in the user's code and one in
 * manganese are the same React's.
 */
const FROM_DOMICILE = /^(@domicile-desktop\/.+|react|react-dom)$/;

/**
 * The directory whose `package.json` and `bun.lock` an entry's packages go
 * in: the nearest above it that has a `package.json`, or the entry's own
 * where none does — and one is made there.
 */
export const projectOf = (entry: string, exists: Exists): string => {
  const own = path.dirname(path.resolve(entry));
  return nearestProject(own, exists) ?? own;
};

/** `directory` or the nearest above it with a `package.json`, if any has. */
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

/** What `imported` names that `manifest` does not list, in order. */
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
 * What a build is a function of: every file of the user's it reaches, the
 * lockfile that pins what it imports, and the Domicile it is built against.
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
