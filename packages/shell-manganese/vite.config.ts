import { shellBuild } from "@domicile-desktop/component-library/vite-shell";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { options } from "./src/options";

// Builds the shell as a module. Domicile writes the document and serves this
// directory, so there is no `index.html` and the CSS ships in the bundle. See
// `@domicile-desktop/component-library/vite-shell` for the reasons.
//
// Bundling the CSS prevents a theme flash: a `<link>` would let the browser
// paint before `ThemeProvider` runs.
//
// `base: "./"` makes emitted URLs relative to the document Domicile writes.
//
// `options` goes to `options.json` beside the module, for the Settings app.
const shell = shellBuild({ entry: "src/index.tsx", options });

export default defineConfig({
  base: "./",
  build: { ...shell.build, outDir: ".vite/renderer/main_window" },
  plugins: [react(), ...shell.plugins],
});
