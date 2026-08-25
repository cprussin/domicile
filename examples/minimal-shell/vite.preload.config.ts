import { defineConfig } from "vite";

// The Electron preload. Electron and the node builtins come from the runtime
// rather than the bundle.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/preload.ts",
      fileName: () => "[name].cjs",
      formats: ["cjs"],
    },
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron", /^node:/],
    },
  },
});
