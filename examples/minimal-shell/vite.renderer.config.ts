import { defineConfig } from "vite";

// The page. `base: "./"` keeps the emitted asset URLs relative, so the bundle
// loads over `file://` when Electron opens it directly.
export default defineConfig({
  base: "./",
  build: {
    outDir: ".vite/renderer/main_window",
  },
});
