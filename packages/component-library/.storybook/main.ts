import pandacssPostcssPlugin from "@pandacss/dev/postcss";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  addons: ["@storybook/addon-docs", "@storybook/addon-themes"],
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  viteFinal: (config) =>
    mergeConfig(config, {
      // Rolldown's "lazy barrel" optimization miscompiles `@base-ui/react`'s
      // side-effect-free store barrel (`@base-ui/utils/store`): when a
      // component pulls only part of the barrel (e.g. Dialog imports
      // `createSelector` but not `createSelectorMemoized`), the unused
      // re-export module is emitted with its top-level `createSelectorCreator`
      // call retained but its `reselect` import binding dropped, so the
      // production build throws `createSelectorCreator is not defined` at
      // render time. Disabling the optimization restores the correct binding.
      // Only affects the production `storybook build`; the dev server (esbuild)
      // is unaffected. Remove once the Rolldown bug is fixed upstream.
      build: { rolldownOptions: { experimental: { lazyBarrel: false } } },
      css: { postcss: { plugins: [pandacssPostcssPlugin] } },
    }),
};
export default config;
