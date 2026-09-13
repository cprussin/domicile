import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/**
 * Fold the stylesheet back into the entry chunk.
 *
 * Vite extracts every `import "./x.css"` into an asset and expects a document
 * to `<link>` it. Domicile's document has no link, so an extracted stylesheet
 * is a file nobody fetches and the desktop comes up unstyled with nothing in
 * any log to say why.
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
      // Prepended rather than appended, so the stylesheet is in the document
      // before the shell's first statement rather than a frame later.
      entry.code = `(()=>{const s=document.createElement("style");s.textContent=${css};document.head.append(s);})();\n${entry.code}`;
    }
  },
  name: "domicile:css-in-the-module",
});

// Domicile writes the document and serves this directory, so the shell is built
// from its entry module rather than from an `index.html`. Three things here are
// not vite's defaults and each fails quietly: the `.tsx` entry, the fixed
// `shell.js` name (the module Domicile is given is a path somebody types, and a
// content hash in it changes every build), and `base: "./"` so the emitted URLs
// are relative to the document rather than to a server root.
export default defineConfig({
  base: "./",
  build: {
    outDir: ".vite/renderer/main_window",
    rollupOptions: {
      input: "src/index.tsx",
      output: { entryFileNames: "shell.js" },
    },
    sourcemap: true,
  },
  plugins: [react(), cssInTheModule()],
});
