import { defineConfig } from "vite";

// Build config for the shell bundle. Domicile needs each non-default setting
// below; /docs/SHELL-PACKAGING.md#bundling explains why:
//
// - `input` is a `.ts` entry, since Domicile writes the document itself.
// - `entryFileNames` is fixed so the `shell.js` path is stable.
// - `preserveEntrySignatures` keeps the `Shell` export.
// - `base: "./"` makes URLs relative to the document.
//
// A shell with CSS must also inline it into the bundle, since no document
// `<link>`s it.
export default defineConfig({
  base: "./",
  build: {
    outDir: ".vite/renderer/main_window",
    rollupOptions: {
      input: "src/index.ts",
      output: { entryFileNames: "shell.js" },
      preserveEntrySignatures: "exports-only",
    },
  },
});
