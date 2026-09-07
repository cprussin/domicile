import { defineConfig } from "vite";

// The page, and the whole of this shell's build. `base: "./"` keeps the emitted
// asset URLs relative, so the bundle loads wherever the bridge serves it from.
export default defineConfig({
  base: "./",
  build: {
    outDir: ".vite/renderer/main_window",
  },
});
