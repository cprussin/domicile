import { describe, expect, it } from "bun:test";
import { defineOptions, option } from "@domicile-desktop/sdk/options";

import { optionsAsset, shellBuild } from "./vite-shell";

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

  it("writes the shell's options when it declares some", () => {
    const options = defineOptions({ gaps: option.number("Gaps", 4) });

    expect(
      shellBuild({ entry: "src/index.tsx", options }).plugins.map(
        ({ name }) => name,
      ),
    ).toContain("domicile:shell-options");
    expect(
      shellBuild({ entry: "src/index.tsx" }).plugins.map(({ name }) => name),
    ).not.toContain("domicile:shell-options");
  });
});

describe(optionsAsset, () => {
  it("is options.json beside the module, as the builder writes it", () => {
    const options = defineOptions({ gaps: option.number("Gaps", 4) });

    expect(optionsAsset(options)).toEqual({
      fileName: "options.json",
      source: '{"gaps":{"default":4,"kind":"number","label":"Gaps"}}\n',
      type: "asset",
    });
  });
});
