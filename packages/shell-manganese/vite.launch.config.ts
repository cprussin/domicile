import { defineConfig } from "vite";

// The launcher: the program the user actually runs.
//
// A plain Node bundle rather than an Electron one — it starts the compositor,
// then starts Electron on the display the compositor named. Node builtins are
// the runtime's; everything else is bundled, because an installed shell has no
// `node_modules` beside it.
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
    rollupOptions: {
      external: [/^node:/],
    },
    ssr: true,
  },
});
