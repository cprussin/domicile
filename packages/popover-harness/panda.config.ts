import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { batteryPreset } from "@domicile-desktop/manganese-bar-module-battery/panda-preset";
import { windowManagementPreset } from "@domicile-desktop/manganese-window-management/panda-preset";
import { defineConfig } from "@pandacss/dev";

// The scenes render manganese's bar items, so this scans their source to emit
// their CSS, as `shell-manganese` does. Hashing is deterministic per preset, so
// their class names match the rules generated here.
export default defineConfig({
  // Tests and stories style nothing the scenes draw, and some pass objects
  // the extractor reads as styles.
  exclude: ["**/*.{test,stories}.{ts,tsx}"],
  hash: true,
  include: [
    "./src/**/*.{ts,tsx}",
    "../../packages/component-library/src/**/*.{ts,tsx}",
    "../../packages/manganese-*/src/**/*.{ts,tsx}",
  ],
  jsxFramework: "react",
  // Component props such as content are data; styles use Panda functions.
  jsxStyleProps: "none",
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset, windowManagementPreset, batteryPreset],
});
