import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  exclude: [],
  globalCss: {
    html: {
      _light: { colorScheme: "light" },
      colorScheme: "dark",
    },
    "html, body": {
      backgroundColor: "background",
      color: "foreground",
      fontFamily: "body",
      lineHeight: "normal",
    },
  },
  // Class names hashed, as every package's are. Variables not, so `Accent` can
  // set `--colors-accent` by name.
  hash: { className: true, cssVar: false },
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
      semanticTokens: {
        colors: {
          // Each product's color. `Accent` sets `accent` to one of them.
          domicile: {
            value: {
              _light: "{colors.violet.700}",
              base: "{colors.violet.400}",
            },
          },
          // The preset's `accent`, by name, so it survives inside Domicile's.
          manganese: {
            value: { _light: "{colors.cyan.700}", base: "{colors.cyan.500}" },
          },
          // Code blocks, by highlight.js scope. Code blocks are dark in both
          // themes, so these are too.
          syntax: {
            attr: { value: "{colors.amber.400}" },
            comment: { value: "{colors.neutral.500}" },
            function: { value: "{colors.violet.300}" },
            ground: { value: "{colors.neutral.950}" },
            keyword: { value: "{colors.pink.400}" },
            number: { value: "{colors.rose.300}" },
            plain: { value: "{colors.neutral.200}" },
            property: { value: "{colors.blue.300}" },
            punctuation: { value: "{colors.neutral.400}" },
            string: { value: "{colors.lime.300}" },
            tag: { value: "{colors.sky.300}" },
          },
        },
      },
      tokens: {
        aspectRatios: {
          // The captures' shape: crux's nested output is 1920x1200.
          screen: { value: "16 / 10" },
        },
        fonts: {
          // Set by `next/font` in `src/app/layout.tsx`.
          body: { value: "var(--font-inter), system-ui, sans-serif" },
          code: { value: "var(--font-jetbrains-mono), monospace" },
          display: { value: "var(--font-space-grotesk), sans-serif" },
        },
      },
    },
  },
});
