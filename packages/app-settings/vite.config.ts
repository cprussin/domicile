import { readFileSync } from "node:fs";
import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

// Builds the unpacked extension: `manifest.json` (from `public/`), the page,
// its assets and the app icon. Paths are relative, so the extension loads from
// any directory.
export default defineConfig({
  base: "./",
  build: {
    // The page loads from disk, so its size costs no download. Most of it is
    // the component library's token table, which `theme-core` reads.
    chunkSizeWarningLimit: 2000,
    outDir: ".vite/extension",
    rollupOptions: { input: "settings.html" },
  },
  css: {
    postcss: {
      // @pandacss/dev bundles another postcss version than Vite, so the
      // plugin types differ; the runtime shapes are the same. See
      // shell-manganese's vite.config.ts.
      plugins: [pandacssPostcssPlugin as never],
    },
  },
  plugins: [react(), appIcon()],
});

/**
 * Ships `icons/settings.svg` as `settings.svg` and links it as the page's icon.
 * The link goes in after Vite resolves the page's own URLs, since the file
 * only exists in the output.
 */
function appIcon(): Plugin {
  return {
    generateBundle() {
      this.emitFile({
        fileName: "settings.svg",
        source: readFileSync(new URL("icons/settings.svg", import.meta.url)),
        type: "asset",
      });
    },
    name: "app-settings:icon",
    transformIndexHtml: {
      handler: () => [
        {
          attrs: { href: "./settings.svg", rel: "icon", type: "image/svg+xml" },
          injectTo: "head",
          tag: "link",
        },
      ],
      order: "post",
    },
  };
}
