import { defineConfig } from "vite";

// The Electron main process. Electron and node builtins are provided by the
// runtime, not bundled.
export default defineConfig({
  build: {
    // The three builds share `.vite/`, so only the renderer (built last)
    // clears its own directory.
    emptyOutDir: true,
    lib: {
      entry: "src/main.ts",
      fileName: () => "[name].js",
      formats: ["es"],
    },
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron", /^node:/],
    },
  },
});
