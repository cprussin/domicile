import { describe, expect, it } from "bun:test";

import { shellBuild } from "./vite-shell";

describe(shellBuild, () => {
  it("names the module shell.js by default", () => {
    expect(
      shellBuild({ entry: "src/index.tsx" }).build.rollupOptions.output,
    ).toEqual({ entryFileNames: "shell.js" });
  });

  it("names the module as asked", () => {
    expect(
      shellBuild({ entry: "src/index.tsx", fileName: "settings.js" }).build
        .rollupOptions.output,
    ).toEqual({ entryFileNames: "settings.js" });
  });
});
