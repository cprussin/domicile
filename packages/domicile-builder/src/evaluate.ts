// Evaluates a config module into the JSON the compositor reads, and a shell's
// `options` export into the `options.json` the Settings app reads.
//
// A config's `Shell` export is the desktop and its `options` export the
// shell's declared options; every other export is a config section. The
// compositor does not run JavaScript, so Bun evaluates them here. See
// `docs/WRITING-A-SHELL.md#options`.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BunPlugin } from "bun";

/** Imports resolved from Domicile's install instead of the user's project. */
const FROM_DOMICILE = /^(@domicile-desktop\/[^/]+|react|react-dom)(\/.*)?$/;

/**
 * Evaluate the config module `config` and write every export but `Shell` and
 * `options` to `out` as JSON.
 */
export const evaluate = async (
  config: string,
  out: string,
  domicile: string,
): Promise<void> => {
  const {
    Shell: _shell,
    options: _options,
    ...sections
  } = await exportsOf(config, domicile);
  writeFileSync(out, `${JSON.stringify(sections)}\n`);
};

/**
 * Write the `options` export of the shell `entry` to `out` as JSON. A shell
 * without one has no options, and nothing is written.
 *
 * Only a shell that exports `options` is run: any other may need a page at
 * import, such as a library that adds styles to `document`.
 */
export const extractOptions = async (
  entry: string,
  out: string,
  domicile: string,
): Promise<void> => {
  const module = await bundled(entry, domicile);
  const { exports } = new Bun.Transpiler({ loader: "js" }).scan(
    await Bun.file(module).text(),
  );
  if (exports.includes("options")) {
    const { options } = await import(module);
    writeFileSync(out, `${JSON.stringify(options)}\n`);
  }
};

/**
 * The exports of the module `entry`. Importing it starts no desktop, because
 * nothing calls `Shell`.
 */
const exportsOf = async (
  entry: string,
  domicile: string,
): Promise<Record<string, unknown>> =>
  await import(await bundled(entry, domicile));

/**
 * The module `entry`, bundled to one file so Domicile's packages and React
 * resolve as in a shell build and stylesheet imports are empty.
 */
const bundled = async (entry: string, domicile: string): Promise<string> => {
  const scratch = mkdtempSync(path.join(tmpdir(), "domicile-config-"));
  const built = await Bun.build({
    entrypoints: [entry],
    format: "esm",
    outdir: scratch,
    plugins: [fromDomicile(domicile), noStyles],
    target: "bun",
  });
  const [output] = built.outputs;
  if (!built.success || output === undefined) {
    throw new Error(
      `domicile-builder: ${entry} did not build: ${built.logs.map(String).join("\n")}`,
    );
  } else {
    return output.path;
  }
};

/**
 * Resolve Domicile's packages and React from Domicile's install: the user's
 * imports from manganese, and imports inside Domicile's packages from the
 * package that makes them, which depends on them.
 */
const fromDomicile = (domicile: string): BunPlugin => {
  const manganese = path.join(domicile, "packages", "shell-manganese");
  const ours = `${path.join(domicile, "packages")}${path.sep}`;
  return {
    name: "domicile:from-domicile",
    setup: (build) => {
      build.onResolve(
        { filter: FROM_DOMICILE },
        ({ importer, path: specifier }) => ({
          path:
            specifier === "@domicile-desktop/manganese"
              ? path.join(manganese, "src", "index.tsx")
              : Bun.resolveSync(
                  specifier,
                  importer.startsWith(ours)
                    ? path.dirname(importer)
                    : manganese,
                ),
        }),
      );
    },
  };
};

/** Load stylesheets as empty modules; only a page can use them. */
const noStyles: BunPlugin = {
  name: "domicile:no-styles",
  setup: (build) => {
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
};
