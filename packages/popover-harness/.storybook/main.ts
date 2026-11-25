import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  viteFinal: (config) =>
    mergeConfig(config, {
      // As component-library's: Rolldown's lazy barrel optimization drops an
      // import base-ui needs. Remove once Rolldown fixes it.
      build: { rolldownOptions: { experimental: { lazyBarrel: false } } },
      css: { postcss: { plugins: [pandacssPostcssPlugin] } },
    }),
};
export default config;
