// Vite config for a shell, which Domicile loads as a module instead of an HTML
// page. The build emits a fixed `shell.js`, keeps the entry's exports, and
// inlines CSS into the module. Mistakes here give a blank or unstyled desktop
// with no error. See docs/SHELL-PACKAGING.md.
//
// CSS goes in the module to avoid a theme flash. A stylesheet `<link>` blocks
// render but module scripts are deferred, so the page would paint before the
// shell applies its theme.

import type { Plugin } from "vite";

/**
 * Moves the CSS assets vite extracted into the entry chunk as a `<style>`.
 *
 * Runs in `generateBundle` with `enforce: "post"` because the CSS assets only
 * exist at that point.
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
      // No entry chunk. Vite reports that better than this plugin can.
      return;
    }
    for (const style of styles) {
      delete bundle[style.name];
    }
    // Prepend so the styles are in place before the shell reads its theme.
    entry.code = `${installStyles(styles.map((style) => style.css).join("\n"))}\n${entry.code}`;
  },
  name: "domicile:css-in-the-module",
});

/** Code that adds `css` to the document as a `<style>`. */
const installStyles = (css: string): string =>
  [
    "(() => {",
    `  const style = document.createElement("style");`,
    `  style.textContent = ${JSON.stringify(css)};`,
    "  document.head.append(style);",
    "})();",
  ].join("\n");

/** Options for {@link shellBuild}. */
export type ShellBuild = {
  /** The shell's entry module, relative to the config. */
  readonly entry: string;
};

/**
 * The `build` and `plugins` a shell's vite config needs. Spread it into the
 * shell's own config.
 */
export const shellBuild = ({ entry }: ShellBuild) => ({
  build: {
    // No content hash, so configs and packages can name the module path.
    //
    // Keep the entry's exports. Vite's app default drops them, which removes
    // `Shell` and all code only it reaches.
    rollupOptions: {
      input: entry,
      output: { entryFileNames: "shell.js" },
      preserveEntrySignatures: "exports-only" as const,
    },
    sourcemap: true,
  },
  plugins: [cssInTheModule()],
});
