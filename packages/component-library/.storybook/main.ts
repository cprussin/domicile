import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  viteFinal: (config) =>
    mergeConfig(config, {
      // Rolldown's lazy barrel optimization drops the `reselect` import from
      // `@base-ui/utils/store`, so `storybook build` throws
      // `createSelectorCreator is not defined` at render. Remove once Rolldown
      // fixes it.
      build: { rolldownOptions: { experimental: { lazyBarrel: false } } },
      css: { postcss: { plugins: [pandacssPostcssPlugin] } },
    }),
};
export default config;
