// Shells distributed as packages, such as `my-shell` on npm or
// `github:me/my-shell`.

import path from "node:path";

import { z } from "zod";

import type { Manifest } from "./project";

/**
 * The project directory under the cache that `spec` installs into.
 *
 * Each package gets its own project, so packages never share a lockfile and a
 * second start installs nothing.
 */
export const packageProject = (cache: string, spec: string): string =>
  path.join(
    cache,
    "packages",
    new Bun.CryptoHasher("sha256").update(spec).digest("hex"),
  );

/**
 * The installed package's name.
 *
 * Throws unless the project lists exactly one dependency. The project exists
 * for that package alone, so anything else means someone edited it by hand.
 */
export const installedName = (manifest: Manifest): string => {
  const names = Object.keys(manifest.dependencies ?? {});
  const [name] = names;
  if (names.length !== 1 || name === undefined) {
    throw new Error(
      `domicile-builder: a package's project lists one package, and this lists ${JSON.stringify(names)}`,
    );
  }
  return name;
};

/** The fields of a shell package's `package.json` read here. */
const shellManifestSchema = z.looseObject({
  domicile: z.looseObject({ shell: z.string().min(1) }).optional(),
});

/**
 * The prebuilt module a package's `package.json` names in
 * `"domicile": { "shell": "dist/shell.js" }`, relative to that file.
 * `undefined` means the package is built from its entry.
 */
export const prebuiltOf = (text: string): string | undefined =>
  shellManifestSchema.parse(JSON.parse(text)).domicile?.shell;
