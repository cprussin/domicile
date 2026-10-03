// What an entry is made of: every file of the user's it reaches, and every
// package it imports.
//
// Read before anything is installed or bundled, because both questions are
// answered from it: which packages the project needs, and whether anything
// changed since the last build.

import path from "node:path";

/** What a file is, read off disk: its text, or `undefined` for none. */
export type ReadFile = (file: string) => string | undefined;

/** An entry's local files and the packages they import. */
export type Graph = {
  /** Every file of the user's the entry reaches, by absolute path. */
  readonly files: ReadonlyMap<string, string>;
  /** Every package imported, by name: `zod`, `@domicile-desktop/sdk`. */
  readonly packages: ReadonlySet<string>;
};

/** The suffixes a relative import may leave off, in the order they are tried. */
const SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

/** The files whose imports are read; anything else is a leaf, like CSS. */
const SCRIPTS: ReadonlyMap<string, "ts" | "tsx" | "js" | "jsx"> = new Map([
  [".ts", "ts"],
  [".tsx", "tsx"],
  [".js", "js"],
  [".jsx", "jsx"],
  [".mjs", "js"],
]);

/**
 * Every file `entry` reaches by relative imports, and every package any of
 * them imports.
 *
 * Throws on a relative import that names no file: the bundler would refuse
 * it too, later and in more words.
 */
export const importGraph = (entry: string, read: ReadFile): Graph => {
  const files = new Map<string, string>();
  const packages = new Set<string>();
  const pending = [path.resolve(entry)];
  while (pending.length > 0) {
    const file = pending.pop() ?? "";
    const text = read(file);
    if (text === undefined) {
      throw new Error(`domicile-builder: no file at ${file}`);
    }
    files.set(file, text);
    const loader = SCRIPTS.get(path.extname(file));
    const imports =
      loader === undefined
        ? []
        : new Bun.Transpiler({ loader }).scanImports(text);
    for (const { path: specifier } of imports) {
      if (isRelative(specifier)) {
        const found = resolved(path.dirname(file), specifier, read);
        if (!files.has(found)) {
          pending.push(found);
        }
      } else {
        packages.add(packageOf(specifier));
      }
    }
  }
  return { files, packages };
};

/** The package a bare specifier names: its scope and name, without a subpath. */
export const packageOf = (specifier: string): string => {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
};

const isRelative = (specifier: string): boolean =>
  specifier.startsWith("./") ||
  specifier.startsWith("../") ||
  specifier.startsWith("/");

/** The file a relative import from `directory` names, trying each suffix. */
const resolved = (
  directory: string,
  specifier: string,
  read: ReadFile,
): string => {
  const base = path.resolve(directory, specifier);
  const found = SUFFIXES.map((suffix) => `${base}${suffix}`).find(
    (candidate) => read(candidate) !== undefined,
  );
  if (found === undefined) {
    throw new Error(
      `domicile-builder: ${JSON.stringify(specifier)} from ${directory} names no file`,
    );
  }
  return found;
};
