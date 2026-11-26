// Node's `module.registerHooks` for the app's main, which Bun lacks. VS Code
// imports it at start and registers resolve hooks with it.

import {
  access,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import Module, { isBuiltin } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BunPlugin } from "bun";
import { z } from "zod";

/** What `require` resolves under, as Node gives a resolve hook. */
const REQUIRE_CONDITIONS = ["require", "node", "module-sync", "node-addons"];

/** An ES import of `registerHooks` from `node:module`. */
const IMPORTS_HOOKS =
  /import\s*\{[^}]*\bregisterHooks\b[^}]*\}\s*from\s*["'](?:node:)?module["']/;

/** Where those scripts import `node:module` from instead. */
const WITH_HOOKS = "domicile:node-module";

/** The part of `node:module` that `require` resolves through. */
export type Resolver = {
  _resolveFilename: (
    request: string,
    parent: { readonly filename?: string | null } | undefined,
    isMain: boolean,
    options?: unknown,
  ) => string;
};

type ResolveContext = {
  readonly conditions: readonly string[];
  readonly importAttributes: Readonly<Record<string, string>>;
  readonly parentURL: string | undefined;
};

type Resolved = {
  readonly format?: string | undefined;
  readonly shortCircuit?: boolean | undefined;
  readonly url: string;
};

type NextResolve = (
  specifier: string,
  context?: Partial<ResolveContext>,
) => Resolved;

type Hooks = {
  readonly load?: unknown;
  readonly resolve?: (
    specifier: string,
    context: ResolveContext,
    nextResolve: NextResolve,
  ) => Resolved;
};

/**
 * `module.registerHooks` over `resolver`: a resolve hook runs for `require`,
 * `require.resolve` and `createRequire`, before the hooks registered earlier.
 * The app's imports don't pass through it, which `warn` says. A load hook
 * throws.
 */
export const createRegisterHooks =
  (resolver: Resolver, warn: (why: string) => void) => (hooks: Hooks) => {
    if (hooks.load !== undefined) {
      throw new Error(
        "module.registerHooks load hooks don't run on Domicile's Electron",
      );
    }
    const resolve = hooks.resolve;
    if (resolve === undefined) {
      return { deregister: () => undefined };
    } else {
      warn(
        "module.registerHooks resolve hooks run for require only: the app's imports resolve as Bun resolves them",
      );
      const previous = resolver._resolveFilename;
      resolver._resolveFilename = (request, parent, isMain, options) => {
        const next: NextResolve = (specifier) =>
          toResolved(
            previous.call(resolver, specifier, parent, isMain, options),
          );
        return fromResolved(
          resolve(
            request,
            {
              conditions: REQUIRE_CONDITIONS,
              importAttributes: {},
              parentURL: parentURL(parent),
            },
            next,
          ),
        );
      };
      return {
        deregister: () => {
          resolver._resolveFilename = previous;
        },
      };
    }
  };

/**
 * The real paths of the scripts under `mirror` that import `registerHooks`
 * from `node:module`, following the mirror's links into the install. Kept
 * beside the mirror, which a changed app doesn't reuse.
 */
export const filesImportingHooks = async (
  mirror: string,
): Promise<string[]> => {
  const kept = join(dirname(mirror), "module-hooks.json");
  if (await exists(kept)) {
    return z.array(z.string()).parse(JSON.parse(await readFile(kept, "utf8")));
  } else {
    const found = await scan(mirror);
    await writeFile(kept, JSON.stringify(found));
    return found;
  }
};

/**
 * Gives `files` a `node:module` with `registerHooks`. Bun won't let a plugin
 * replace a builtin, so they import a copy of it that has one. Only these
 * files are loaded through the plugin: Bun takes a script a plugin loads as
 * an ES module, which would empty a CommonJS one's exports.
 */
export const moduleHooksPlugin = (
  files: readonly string[],
  registerHooks: ReturnType<typeof createRegisterHooks>,
): BunPlugin => ({
  name: "node-module-hooks",
  setup: (build) => {
    const withHooks = { ...Module, registerHooks };
    build.module(WITH_HOOKS, () => ({
      exports: { ...withHooks, default: withHooks },
      loader: "object",
    }));
    if (files.length > 0) {
      build.onLoad(
        { filter: new RegExp(`^(?:${files.map(escapeRegExp).join("|")})$`) },
        async ({ path }) => ({
          contents: (await readFile(path, "utf8")).replace(
            /(from\s*)(["'])(?:node:)?module\2/g,
            `$1$2${WITH_HOOKS}$2`,
          ),
          loader: "js",
        }),
      );
    }
  },
});

/** A filename `require` resolved, as a hook sees it. */
const toResolved = (filename: string): Resolved =>
  isBuiltin(filename)
    ? {
        format: "builtin",
        url: filename.startsWith("node:") ? filename : `node:${filename}`,
      }
    : { format: "commonjs", url: pathToFileURL(filename).href };

/** What `require` loads for a hook's answer. */
const fromResolved = ({ url }: Resolved) => {
  if (url.startsWith("file:")) {
    return fileURLToPath(url);
  } else if (url.startsWith("node:") && !isBuiltin(url)) {
    // `node:original-fs`, which Bun knows only by its bare name.
    return url.slice("node:".length);
  } else {
    return url;
  }
};

/** The requiring module's URL, as a resolve hook's `parentURL`. */
const parentURL = (parent: Parameters<Resolver["_resolveFilename"]>[1]) =>
  parent?.filename === undefined || parent.filename === null
    ? undefined
    : pathToFileURL(parent.filename).href;

/** Every script in the directories `mirror` holds or links to that imports the hooks. */
const scan = async (mirror: string) => {
  const roots = await Promise.all(
    (await readdir(mirror)).map((name) => realpath(join(mirror, name))),
  );
  const found = await Promise.all(roots.map(scanDirectory));
  return found.flat();
};

const scanDirectory = async (root: string): Promise<string[]> => {
  if ((await stat(root)).isDirectory()) {
    const scripts = (
      await readdir(root, { recursive: true, withFileTypes: true })
    )
      .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));
    const importing = await Promise.all(
      scripts.map(async (path) =>
        IMPORTS_HOOKS.test(await readFile(path, "latin1")) ? [path] : [],
      ),
    );
    return importing.flat();
  } else {
    return [];
  }
};

const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
