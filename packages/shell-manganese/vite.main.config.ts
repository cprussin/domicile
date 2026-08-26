import { defineConfig } from "vite";

// The Electron main process. Electron and node builtins are provided by the
// runtime, not bundled.
export default defineConfig({
  build: {
    // The four builds share `.vite/`, so only the launcher (built first)
    // clears the directory.
    emptyOutDir: false,
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
