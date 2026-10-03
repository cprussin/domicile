// A shell that is a package — `my-shell` on npm, `github:me/my-shell` — and
// where it is installed.

import path from "node:path";

import { z } from "zod";

import type { Manifest } from "./project";

/**
 * Where `spec` is installed: a project of its own under the cache, so two
 * packages never share a lockfile and the second start of one installs
 * nothing.
 */
export const packageProject = (cache: string, spec: string): string =>
  path.join(
    cache,
    "packages",
    new Bun.CryptoHasher("sha256").update(spec).digest("hex"),
  );

/**
 * The name the package installed as. Its project lists exactly one
 * dependency, because it is made for that package alone; anything else is a
 * project somebody changed by hand.
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

/** A package's own `package.json`, as far as a shell's is read. */
const shellManifestSchema = z.looseObject({
  domicile: z.looseObject({ shell: z.string().min(1) }).optional(),
});

/**
 * The prebuilt module a package's `package.json` names as
 * `"domicile": { "shell": "dist/shell.js" }`, relative to it — or
 * `undefined`, and the package is built from its entry.
 */
export const prebuiltOf = (text: string): string | undefined =>
  shellManifestSchema.parse(JSON.parse(text)).domicile?.shell;
