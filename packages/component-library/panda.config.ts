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
  // Storybook-only static CSS. Lives here rather than in `domicilePreset` so
  // downstream consumers don't pay for every variant in their own builds — they
  // can opt into the same coverage via their own panda config if they need to.
  // Stories render component variants and font sizes dynamically (e.g. the
  // control AllVariations stories iterate every size/variant pair; Kbd's
  // AllVariations iterates every fontSize token), so the classes must be
  // emitted even though no static call site references them.
  staticCss: {
    css: [{ properties: { fontSize: ["*"] } }],
    recipes: { control: ["*"] },
  },
});
