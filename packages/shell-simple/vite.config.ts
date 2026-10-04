import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/**
 * Inlines the stylesheet into the entry chunk.
 *
 * Vite extracts CSS imports into an asset for a `<link>`. Domicile's document
 * has no link, so the desktop would load unstyled with no error.
 */
const cssInTheModule = (): Plugin => ({
  enforce: "post",
  generateBundle: (_options, bundle) => {
    const sheets = Object.entries(bundle).flatMap(([name, output]) =>
      output.type === "asset" && name.endsWith(".css")
        ? [{ css: String(output.source), name }]
        : [],
    );
    const entry = Object.values(bundle).find(
      (output) => output.type === "chunk" && output.isEntry,
    );
    if (sheets.length > 0 && entry?.type === "chunk") {
      for (const sheet of sheets) {
        delete bundle[sheet.name];
      }
      const css = JSON.stringify(sheets.map((sheet) => sheet.css).join("\n"));
      // Prepended so the styles apply before the shell's first statement runs.
      entry.code = `(()=>{const s=document.createElement("style");s.textContent=${css};document.head.append(s);})();\n${entry.code}`;
    }
  },
  name: "domicile:css-in-the-module",
});

// Domicile writes the document and serves this directory, so the build starts
// from the entry module, not `index.html`. These non-defaults each fail
// silently if wrong:
// - the `.tsx` entry.
// - `shell.js`: users type this path, so it has no content hash.
// - `preserveEntrySignatures`: an app build drops the entry's exports,
//   including `Shell`.
// - `base: "./"`: emitted URLs are relative to the document.
export default defineConfig({
  base: "./",
  build: {
    outDir: ".vite/renderer/main_window",
    rollupOptions: {
      input: "src/index.tsx",
      output: { entryFileNames: "shell.js" },
      preserveEntrySignatures: "exports-only",
    },
    sourcemap: true,
  },
  plugins: [react(), cssInTheModule()],
});
