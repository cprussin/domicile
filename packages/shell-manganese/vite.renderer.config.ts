import { shellBuild } from "@domicile/component-library/vite-shell";
import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The chrome itself, built as a module rather than from a document.
//
// Domicile writes the document and serves this directory, so there is no
// `index.html` here and the stylesheet travels inside the bundle. All three of
// those decisions are `shellBuild`'s — see
// `@domicile/component-library/vite-shell` for why each one.
//
// The CSS moving into the module is what ends this shell's theme flash: a
// `<link>` is render-blocking and a module script is deferred, so with one the
// browser painted before `ThemeProvider` had run. There is nothing to paint
// first now.
//
// `base: "./"` so the emitted URLs are relative to the document Domicile
// writes rather than to a server root.
const shell = shellBuild({ entry: "src/index.tsx" });

export default defineConfig({
  base: "./",
  build: { ...shell.build, outDir: ".vite/renderer/main_window" },
  css: {
    postcss: {
      // @pandacss/dev bundles its own postcss while the catalog (and Vite) use
      // a different postcss version, so the PluginCreator types don't unify
      // across the two instances. Cast through never to *erase* the type: a
      // plain `@ts-expect-error` only suppresses the local assignment, leaving
      // the incompatible type to blow up the deep `UserConfig` comparison
      // (TS2321, excessive stack depth). The shapes are identical at runtime.
      plugins: [pandacssPostcssPlugin as never],
    },
  },
  plugins: [react(), ...shell.plugins],
});
