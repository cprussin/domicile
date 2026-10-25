import { shellBuild } from "@domicile-desktop/component-library/vite-shell";
import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the app module `history.js`, which `domicile open --app` runs. The CSS
// ships in the module, as a shell's does; see
// `@domicile-desktop/component-library/vite-shell`. `base: "./"` makes emitted
// URLs relative to the module's directory.
const app = shellBuild({ entry: "src/index.tsx", fileName: "history.js" });

export default defineConfig({
  base: "./",
  build: {
    ...app.build,
    // The module loads from disk, so its size costs no download. Most of it
    // is the component library's token table, which `theme-core` reads.
    chunkSizeWarningLimit: 2000,
    outDir: ".vite/app",
  },
  css: {
    postcss: {
      // @pandacss/dev bundles another postcss version than Vite, so the
      // plugin types differ; the runtime shapes are the same. See
      // shell-manganese's vite.config.ts.
      plugins: [pandacssPostcssPlugin as never],
    },
  },
  plugins: [react(), ...app.plugins],
});
