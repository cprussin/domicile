// Builds a user's shell entry into a module against Domicile's install.

import path from "node:path";

import { shellBuild } from "@domicile-desktop/component-library/vite-shell";
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
 * The build transpiles and bundles only. Packages ship their CSS prebuilt.
 */
export const bundle = async (
  entry: string,
  out: string,
  domicile: string,
): Promise<void> => {
  const shell = shellBuild({ entry });
  await build({
    base: "./",
    build: { ...shell.build, emptyOutDir: true, outDir: out },
    configFile: false,
    logLevel: "error",
    plugins: [fromDomicile(domicile), react(), ...shell.plugins],
    root: path.dirname(entry),
  });
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
