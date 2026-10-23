import type { NextConfig } from "next";

const config: NextConfig = {
  // The component library ships TypeScript source, not a build.
  transpilePackages: ["@domicile-desktop/component-library"],
};

export default config;
