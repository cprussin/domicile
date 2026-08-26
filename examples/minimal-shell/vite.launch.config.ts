import { defineConfig } from "vite";

// The launcher — the program the user runs. A plain Node bundle rather than an
// Electron one: it starts the compositor first and Electron second, because
// Electron settles which display it draws on while it starts up.
export default defineConfig({
  build: {
    // First of the four builds, and the one that clears the directory.
    emptyOutDir: true,
    lib: {
      entry: "src/launch.ts",
      fileName: () => "[name].js",
      formats: ["es"],
    },
    outDir: ".vite/build",
    rollupOptions: { external: [/^node:/] },
    ssr: true,
  },
});
