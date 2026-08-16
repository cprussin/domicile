import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default to the fast node environment; DOM-dependent suites opt into
    // jsdom per-file with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["chrome-sdk/**/*.test.js", "shells/**/*.test.js"],
  },
});
