import { defineConfig } from "vite";

// The preload runs in Electron's isolated world, which loads CommonJS — hence
// the `.cjs` output next to the ESM main bundle.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/preload.ts",
      fileName: () => "preload.cjs",
      formats: ["cjs"],
    },
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron", /^node:/],
    },
  },
});
