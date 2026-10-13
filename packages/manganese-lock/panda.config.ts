import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

import { lockPreset } from "./src/panda-preset";

// The shell that renders this package scans its source and emits the CSS. This
// config generates `styled-system/` for the package's own imports and tests.
export default defineConfig({
  exclude: [],
  hash: true,
  include: [
    "./src/**/*.{ts,tsx}",
    "../../packages/component-library/src/**/*.{ts,tsx}",
  ],
  jsxFramework: "react",
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset, lockPreset],
});
