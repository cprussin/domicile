// One shell module out of a user's entry, built against Domicile's install.

import { writeFileSync } from "node:fs";
import path from "node:path";

import { shellBuild } from "@domicile-desktop/component-library/vite-shell";
import panda from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { build } from "vite";

/** What resolves from Domicile's install rather than the user's project. */
const FROM_DOMICILE = /^(@domicile-desktop\/[^/]+|react|react-dom)(\/.*)?$/;

/** Manganese, whose dependencies are Domicile's and whose styles are built. */
const manganeseIn = (domicile: string): string =>
  path.join(domicile, "packages", "shell-manganese");

/**
 * Bundle `entry` into `out/shell.js`, as `@domicile-desktop/component-library`'s
 * `shellBuild` builds one: its `Shell` export kept and its stylesheet inside.
 *
 * **Domicile's packages and React come from `domicile`**, whatever the
 * project installed: resolved as manganese resolves them, so a hook in the
 * user's code and one in manganese's are the same React's, and the SDK
 * speaks the protocol of the Domicile it was built by.
 *
 * **Manganese's styles are built here**, by Panda over manganese's own config:
 * Panda's `css()` only names classes, and the build that scans a call is what
 * writes its rule. `files`, the user's own, are scanned beside manganese's, so
 * a `css()` from `@domicile-desktop/manganese/css` in them has its rule too.
 */
export const bundle = async (
  entry: string,
  out: string,
  domicile: string,
  files: readonly string[],
): Promise<void> => {
  const manganese = manganeseIn(domicile);
  const shell = shellBuild({ entry });
  await build({
    base: "./",
    build: { ...shell.build, emptyOutDir: true, outDir: out },
    configFile: false,
    css: {
      postcss: {
        // @pandacss/dev bundles its own postcss, whose plugin types do not
        // unify with vite's; cast through never to erase the type, as
        // manganese's `vite.config.ts` does and says why.
        plugins: [
          panda({
            configPath: scanning(`${out}.panda.config.mjs`, manganese, files),
            cwd: manganese,
          }) as never,
        ],
      },
    },
    logLevel: "error",
    plugins: [fromDomicile(domicile), react(), ...shell.plugins],
    root: path.dirname(entry),
  });
};

/**
 * Write `config`: manganese's Panda config, scanning `files` as well.
 *
 * Written rather than passed, because Panda's PostCSS plugin takes a config's
 * path and nothing else; beside the build rather than in a temporary
 * directory, because the plugin keeps the config it loaded for the life of
 * the process and reads it again on the next build.
 */
const scanning = (
  config: string,
  manganese: string,
  files: readonly string[],
): string => {
  const theirs = JSON.stringify(path.join(manganese, "panda.config.ts"));
  writeFileSync(
    config,
    `import config from ${theirs};
export default { ...config, include: [...config.include, ...${JSON.stringify(files)}] };
`,
  );
  return config;
};

/**
 * Resolve what the user's code imports of Domicile's and React from
 * Domicile's install. What Domicile's own packages import is left to them.
 */
const fromDomicile = (domicile: string): Plugin => {
  const manganese = manganeseIn(domicile);
  const anchor = path.join(manganese, "src", "index.tsx");
  const ours = `${path.join(domicile, "packages")}${path.sep}`;
  return {
    enforce: "pre",
    name: "domicile:from-domicile",
    resolveId(source, importer) {
      if (!FROM_DOMICILE.test(source) || importer?.startsWith(ours)) {
        return null;
      } else if (source === "@domicile-desktop/manganese") {
        return anchor;
      } else {
        return this.resolve(source, anchor, { skipSelf: true });
      }
    },
  };
};
