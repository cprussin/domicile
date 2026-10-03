// A config module, as the JSON the compositor reads.
//
// A config is a module like any shell: its `Shell` is the desktop, and every
// other export is a section of the compositor's config. The compositor never
// runs JavaScript, so the sections are evaluated here, under Bun, and written
// out as JSON.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BunPlugin } from "bun";

/** What resolves from Domicile's install rather than the user's project. */
const FROM_DOMICILE = /^(@domicile\/[^/]+|react|react-dom)(\/.*)?$/;

/**
 * Evaluate the config module `config` and write every export but `Shell` to
 * `out` as JSON.
 *
 * **Bundled before it is imported**, so `@domicile/*` and React resolve from
 * `domicile` as a shell build resolves them, and a stylesheet a shell imports
 * — which only a page can use — is nothing here. Importing the module runs no
 * desktop: a shell does nothing until `Shell` is called, and nothing calls it.
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

/** `@domicile/*` and React from Domicile's install, as manganese has them. */
const fromDomicile = (domicile: string): BunPlugin => {
  const manganese = path.join(domicile, "packages", "shell-manganese");
  return {
    name: "domicile:from-domicile",
    setup: (build) => {
      build.onResolve({ filter: FROM_DOMICILE }, ({ path: specifier }) => ({
        path:
          specifier === "@domicile/manganese"
            ? path.join(manganese, "src", "index.tsx")
            : Bun.resolveSync(specifier, manganese),
      }));
    },
  };
};

/** A stylesheet, which a page installs and a config has no use for. */
const noStyles: BunPlugin = {
  name: "domicile:no-styles",
  setup: (build) => {
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
};
