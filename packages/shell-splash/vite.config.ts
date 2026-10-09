import { shellBuild } from "@domicile-desktop/component-library/vite-shell";
import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the splash as a shell module, like manganese: Domicile writes the
// document, so the CSS ships in the bundle. See
// `@domicile-desktop/component-library/vite-shell`.
const shell = shellBuild({ entry: "src/index.tsx" });

export default defineConfig({
  base: "./",
  build: { ...shell.build, outDir: ".vite/renderer/main_window" },
  css: {
    postcss: {
      // @pandacss/dev bundles another postcss version than Vite, so the
      // plugin types differ; the runtime shapes are the same. See
      // shell-manganese's vite.config.ts.
      plugins: [pandacssPostcssPlugin as never],
    },
  },
  plugins: [react(), ...shell.plugins],
});
