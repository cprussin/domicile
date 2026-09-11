// What a shell's vite build has to be for Domicile to serve it as a module.
//
// Domicile writes the document, so a shell is built from its entry module
// rather than from an HTML file. Three things follow, none of them vite's
// default and all three of which fail quietly if you get them wrong:
//
//   the entry     a `.ts` file rather than an HTML file, so nothing emits a
//                 document for Domicile to have to ignore
//   its name      fixed, not hashed. The module Domicile is given is a path
//                 somebody types or a package computes, and neither can know
//                 `index-D6oz2ygI.js`
//   the CSS       *inside* the JavaScript, because the document Domicile
//                 writes carries no `<link>` — see below
//
// Shared rather than copied into both shells, and exported for shells outside
// this repository, because getting any of the three wrong produces a desktop
// that comes up blank or unstyled with nothing in any log to say why.
//
// WHY THE CSS GOES IN THE JAVASCRIPT, which is the part that pays for itself.
// A `<link rel="stylesheet">` is render-blocking and a `type="module"` script
// is always deferred, so with a link the browser paints *before* any of the
// shell's code has run. That is the whole of manganese's theme flash: the
// stylesheet applies, the page paints light, and only then does the module get
// to read the theme. With no link there is nothing to paint yet, so a shell's
// first line is early enough — the flash stops being a thing to work around
// and becomes a thing that cannot happen.

import type { Plugin } from "vite";

/**
 * Fold the CSS vite extracted back into the entry chunk.
 *
 * Vite pulls every `import "./x.css"` out into an asset and expects a document
 * to link it. There is no document here, so this puts it back: the stylesheet
 * is appended to the entry as a `<style>` the module installs on itself, and
 * the asset is dropped so nothing ships a file nobody fetches.
 *
 * `enforce: "post"` so it runs after the CSS has actually been emitted;
 * `generateBundle` rather than a transform because that is the first point at
 * which the extracted asset exists to be read.
 */
const cssInTheModule = (): Plugin => ({
  enforce: "post",
  generateBundle: (_options, bundle) => {
    const styles = Object.entries(bundle).flatMap(([name, output]) =>
      output.type === "asset" && name.endsWith(".css")
        ? [{ css: String(output.source), name }]
        : [],
    );
    if (styles.length === 0) {
      return;
    }
    const entry = Object.values(bundle).find(
      (output) => output.type === "chunk" && output.isEntry,
    );
    if (entry === undefined || entry.type !== "chunk") {
      // Nothing to fold it into, which means the build produced no entry at
      // all. Left for vite to report rather than reported here: this plugin
      // knows less about why than the build does.
      return;
    }
    for (const style of styles) {
      delete bundle[style.name];
    }
    // Prepended, not appended: the module's own first statements are where a
    // shell reads its theme, and they should see the stylesheet already in the
    // document rather than a frame later.
    entry.code = `${installStyles(styles.map((style) => style.css).join("\n"))}\n${entry.code}`;
  },
  name: "domicile:css-in-the-module",
});

/** The snippet that puts a stylesheet in the document it is loaded into. */
const installStyles = (css: string): string =>
  [
    "(() => {",
    `  const style = document.createElement("style");`,
    `  style.textContent = ${JSON.stringify(css)};`,
    "  document.head.append(style);",
    "})();",
  ].join("\n");

/** What to build, for a shell that is a module. */
export type ShellBuild = {
  /** The module a shell is: its entry point, relative to the config. */
  readonly entry: string;
};

/**
 * The `build` and `plugins` a shell's vite config needs.
 *
 * Spread into a config rather than returning a whole one, because the rest —
 * postcss, React, whatever a shell uses — is the shell's own business and this
 * has no opinion about it.
 */
export const shellBuild = ({ entry }: ShellBuild) => ({
  build: {
    // No hash. The module Domicile is given is a path, and a path with a
    // content hash in it changes every time the shell does — so nothing could
    // name it: not a person typing it, not the flake computing it, not a
    // shell's own README. The directory is served, so one predictable name in
    // it is all Domicile needs.
    rollupOptions: { input: entry, output: { entryFileNames: "shell.js" } },
    sourcemap: true,
  },
  plugins: [cssInTheModule()],
});
