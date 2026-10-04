import { shellBuild } from "@domicile-desktop/component-library/vite-shell";
import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the shell as a module. Domicile writes the document and serves this
// directory, so there is no `index.html` and the CSS ships in the bundle. See
// `@domicile-desktop/component-library/vite-shell` for the reasons.
//
// Bundling the CSS prevents a theme flash: a `<link>` would let the browser
// paint before `ThemeProvider` runs.
//
// `base: "./"` makes emitted URLs relative to the document Domicile writes.
const shell = shellBuild({ entry: "src/index.tsx" });

export default defineConfig({
  base: "./",
  build: { ...shell.build, outDir: ".vite/renderer/main_window" },
  css: {
    postcss: {
      // @pandacss/dev bundles a different postcss version than Vite, so the
      // plugin types don't match. Casting to `never` erases the type;
      // `@ts-expect-error` would leave it to fail the `UserConfig` comparison
      // with TS2321. The runtime shapes are identical.
      plugins: [pandacssPostcssPlugin as never],
    },
  },
  plugins: [react(), ...shell.plugins],
});
