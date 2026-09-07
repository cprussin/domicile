import { defineConfig } from "vite";

// The page, and the whole of this shell's build.
//
// Three things here are not vite's defaults, and Domicile needs all three —
// /docs/WRITING-A-SHELL.md#bundling says why each one, and what fails quietly
// without it:
//
//   the entry     a `.ts` file, not an HTML file. Domicile writes the
//                 document, so a shell that emitted one would be shipping a
//                 file nothing loads
//   its name      fixed rather than hashed, because `shell.js` is a path
//                 somebody types and a hash changes every build
//   base "./"     so the emitted URLs are relative to the document Domicile
//                 writes rather than to a server root
//
// There is no CSS in this shell, so there is no fourth thing. A shell with a
// stylesheet has to fold it back into the bundle — vite extracts it and
// expects a document to `<link>` it, and there is no link.
export default defineConfig({
  base: "./",
  build: {
    outDir: ".vite/renderer/main_window",
    rollupOptions: {
      input: "src/renderer.ts",
      output: { entryFileNames: "shell.js" },
    },
  },
});
