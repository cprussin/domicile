// Evaluates a config module into the JSON the compositor reads.
//
// A config's `Shell` export is the desktop; every other export is a config
// section. The compositor does not run JavaScript, so Bun evaluates the
// sections here.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BunPlugin } from "bun";

/** Imports resolved from Domicile's install instead of the user's project. */
const FROM_DOMICILE = /^(@domicile-desktop\/[^/]+|react|react-dom)(\/.*)?$/;

/**
 * Evaluate the config module `config` and write every export but `Shell` to
 * `out` as JSON.
 *
 * The module is bundled first, so Domicile's packages and React resolve as in
 * a shell build and stylesheet imports are empty. Importing it starts no
 * desktop, because nothing calls `Shell`.
 */
export const evaluate = async (
  config: string,
  out: string,
  domicile: string,
): Promise<void> => {
  const scratch = mkdtempSync(path.join(tmpdir(), "domicile-config-"));
  const built = await Bun.build({
    entrypoints: [config],
    format: "esm",
    outdir: scratch,
    plugins: [fromDomicile(domicile), noStyles],
    target: "bun",
  });
  const [output] = built.outputs;
  if (!built.success || output === undefined) {
    throw new Error(
      `domicile-builder: ${config} did not build: ${built.logs.map(String).join("\n")}`,
    );
  }
  const { Shell: _shell, ...sections }: Record<string, unknown> = await import(
    output.path
  );
  writeFileSync(out, `${JSON.stringify(sections)}\n`);
};

/** Resolve Domicile's packages and React from Domicile's install. */
const fromDomicile = (domicile: string): BunPlugin => {
  const manganese = path.join(domicile, "packages", "shell-manganese");
  return {
    name: "domicile:from-domicile",
    setup: (build) => {
      build.onResolve({ filter: FROM_DOMICILE }, ({ path: specifier }) => ({
        path:
          specifier === "@domicile-desktop/manganese"
            ? path.join(manganese, "src", "index.tsx")
            : Bun.resolveSync(specifier, manganese),
      }));
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
