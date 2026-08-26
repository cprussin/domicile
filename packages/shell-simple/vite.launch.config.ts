import { defineConfig } from "vite";

// The launcher: the program the user actually runs.
//
// A plain Node bundle rather than an Electron one — it starts the compositor,
// then starts Electron on the display the compositor named. Node builtins are
// the runtime's; everything else is bundled, because an installed shell has no
// `node_modules` beside it.
//
// `noExternal` is what makes that true. `build.ssr` leaves real dependencies
// as bare imports by default — workspace packages get bundled because they are
// symlinked source, so the only thing left outside was `zod`, and the checkout
// this is built in has a `node_modules` for it to be found in. A `nix build`
// does not: the shell it produced started, resolved `zod`, and died before it
// had opened anything.
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
  ssr: { noExternal: true },
});
