import { defineConfig } from "@pandacss/dev";

import { domicilePreset } from "./src/pandacss-preset";

export default defineConfig({
  exclude: [],
  hash: true,
  include: ["./src/**/*.{ts,tsx}"],
  jsxFramework: "react",
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset],
  // Stories render every control variant and font size dynamically, so Panda
  // cannot find them statically. Kept out of `domicilePreset` so consumers
  // don't ship these classes.
  staticCss: {
    css: [{ properties: { fontSize: ["*"] } }],
    recipes: { control: ["*"] },
  },
});
