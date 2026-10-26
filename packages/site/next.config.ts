import type { NextConfig } from "next";

import { movedRedirects } from "./src/docs/moved";

const config: NextConfig = {
  // Old docs routes go to where their pages moved.
  redirects: async () => movedRedirects(),
  // The component library ships TypeScript source, not a build.
  transpilePackages: ["@domicile-desktop/component-library"],
};

export default config;
