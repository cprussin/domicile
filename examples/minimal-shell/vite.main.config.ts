import { defineConfig } from "vite";

// The Electron main. Electron and the node builtins come from the runtime
// rather than the bundle.
export default defineConfig({
  build: {
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
