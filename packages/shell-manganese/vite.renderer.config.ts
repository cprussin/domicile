import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The chrome itself. `base: "./"` keeps the emitted asset URLs relative so the
// bundle loads over `file://` when Electron opens it directly.
export default defineConfig({
  base: "./",
  build: {
    outDir: ".vite/renderer/main_window",
    sourcemap: true,
  },
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
  plugins: [react()],
});
