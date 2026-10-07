import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

// Only for the component-library controls this desktop renders, such as
// `PortalDialogs`. Its own look is `src/shell.css`. Hashing must match the
// library's, so its runtime class names match the rules generated here.
export default defineConfig({
  exclude: [],
  hash: true,
  include: ["../../packages/component-library/src/**/*.{ts,tsx}"],
  jsxFramework: "react",
  outdir: "styled-system",
  // `src/shell.css` resets what this desktop draws.
  preflight: false,
  presets: [domicilePreset],
});
