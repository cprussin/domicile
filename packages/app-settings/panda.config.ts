import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  exclude: [],
  globalCss: {
    html: {
      _light: { colorScheme: "light" },
      colorScheme: "dark",
    },
    "html, body, #root": {
      blockSize: "100%",
    },
  },
  hash: true,
  include: [
    "./src/**/*.{ts,tsx}",
    "../../packages/component-library/src/**/*.{ts,tsx}",
  ],
  jsxFramework: "react",
  outdir: "styled-system",
  preflight: true,
  presets: [domicilePreset],
  theme: {
    extend: {
      keyframes: {
        // A page or panel arriving.
        rise: {
          "0%": { opacity: "0", transform: "translateY({spacing.1.5})" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
});
