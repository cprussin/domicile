import type { Preset } from "@pandacss/dev";
import { defineConfig } from "@pandacss/dev";

import { domicilePreset } from "./pandacss-preset";

/**
 * The Panda config of a package whose CSS a shell emits: the shell scans the
 * package's source, so this config only generates `styled-system/` for the
 * package's own imports and tests. `presets` add to the library's.
 */
export const packagePandaConfig = (...presets: Preset[]) =>
  defineConfig({
    exclude: [],
    hash: true,
    include: [
      "./src/**/*.{ts,tsx}",
      "../../packages/component-library/src/**/*.{ts,tsx}",
    ],
    jsxFramework: "react",
    // Component props such as content are data; styles use Panda functions.
    jsxStyleProps: "none",
    outdir: "styled-system",
    preflight: true,
    presets: [domicilePreset, ...presets],
  });
