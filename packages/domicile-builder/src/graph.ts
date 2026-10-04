// Reads an entry's import graph: the user's files it reaches and the packages
// it imports. The graph decides which packages to install and the cache key.

import path from "node:path";

/** Read a file's text, or `undefined` if there is none. */
export type ReadFile = (file: string) => string | undefined;

/** An entry's local files and the packages they import. */
export type Graph = {
  /** The user's files the entry reaches, by absolute path, with their text. */
  readonly files: ReadonlyMap<string, string>;
  /** Every package imported, by name: `zod`, `@domicile-desktop/sdk`. */
  readonly packages: ReadonlySet<string>;
};

/** Suffixes tried, in order, to resolve a relative import. */
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

/** Extensions whose imports are scanned; other files, like CSS, are leaves. */
const SCRIPTS: ReadonlyMap<string, "ts" | "tsx" | "js" | "jsx"> = new Map([
  [".ts", "ts"],
  [".tsx", "tsx"],
  [".js", "js"],
  [".jsx", "jsx"],
  [".mjs", "js"],
]);

/**
 * Every file `entry` reaches by relative imports, and every package they
 * import.
 *
 * Throws on a relative import that names no file. The bundler would reject it
 * too, but later and less clearly.
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

/** Resolve a relative import from `directory`, trying each suffix. */
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
