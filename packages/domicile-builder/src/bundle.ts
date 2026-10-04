// Builds a user's shell entry into a module against Domicile's install.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { shellBuild } from "@domicile-desktop/component-library/vite-shell";
import panda from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { build } from "vite";

/** Imports resolved from Domicile's install instead of the user's project. */
const FROM_DOMICILE = /^(@domicile-desktop\/[^/]+|react|react-dom)(\/.*)?$/;

/** The manganese package directory in a Domicile install. */
const manganeseIn = (domicile: string): string =>
  path.join(domicile, "packages", "shell-manganese");

/**
 * Bundle `entry` into `out/shell.js`, with its `Shell` export and styles.
 *
 * Domicile's packages and React resolve from `domicile`, not the project. This
 * gives the user's code and manganese one shared React, and keeps the SDK's
 * protocol in step with the running Domicile.
 *
 * Panda's `css()` only names classes; the build that scans a call emits its
 * rule. So the user's `files` are scanned along with manganese's.
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
        // @pandacss/dev bundles its own postcss, whose plugin types don't
        // match vite's. See manganese's `vite.config.ts` for the same cast.
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
 * Write manganese's Panda config to `config`, with `files` added to its scan.
 *
 * Panda's PostCSS plugin only takes a config path, so the config is a file. It
 * sits next to the build output, not in a temp directory, because the plugin
 * keeps the loaded config for the process and rereads it on the next build.
 */
const scanning = (
  config: string,
  manganese: string,
  files: readonly string[],
): string => {
  const theirs = JSON.stringify(path.join(manganese, "panda.config.ts"));
  mkdirSync(path.dirname(config), { recursive: true });
  writeFileSync(
    config,
    `import config from ${theirs};
export default { ...config, include: [...config.include, ...${JSON.stringify(files)}] };
`,
  );
  return config;
};

/**
 * Resolve the user's imports of Domicile's packages and React from Domicile's
 * install. Imports inside Domicile's own packages resolve normally.
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
