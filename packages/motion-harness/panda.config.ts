import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { windowManagementPreset } from "@domicile-desktop/manganese-window-management/panda-preset";
import { defineConfig } from "@pandacss/dev";

// The stories render manganese's own parts, so this scans their source to emit
// their CSS, as `shell-manganese` does. Hashing is deterministic per preset, so
// their class names match the rules generated here.
export default defineConfig({
  // Tests and stories style nothing the stories draw, and some pass objects
  // the extractor reads as styles.
  exclude: ["../../packages/*/src/**/*.{test,stories}.{ts,tsx}"],
  hash: true,
  include: [
    "./src/**/*.{ts,tsx}",
    "../../packages/component-library/src/**/*.{ts,tsx}",
    "../../packages/manganese-window-management/src/**/*.{ts,tsx}",
  ],
  jsxFramework: "react",
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset, windowManagementPreset],
});
