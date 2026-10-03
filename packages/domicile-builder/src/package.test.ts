import { describe, expect, it } from "bun:test";

import { installedName, packageProject, prebuiltOf } from "./package";

describe("packageProject", () => {
  it("is one directory per package, under the cache", () => {
    const one = packageProject("/c", "github:me/shell");
    expect(one.startsWith("/c/packages/")).toBe(true);
    expect(packageProject("/c", "github:me/shell")).toBe(one);
    expect(packageProject("/c", "my-shell")).not.toBe(one);
  });
});

describe("installedName", () => {
  it("is the one package the project was made to install", () => {
    expect(
      installedName({ dependencies: { "my-shell": "github:me/shell" } }),
    ).toBe("my-shell");
  });

  it("refuses a project of none, or of more than one", () => {
    expect(() => installedName({})).toThrow();
    expect(() => installedName({ dependencies: { a: "1", b: "1" } })).toThrow();
  });
});

describe("prebuiltOf", () => {
  it("is the module a package's `domicile.shell` names, or none", () => {
    expect(prebuiltOf('{"domicile":{"shell":"dist/shell.js"}}')).toBe(
      "dist/shell.js",
    );
    expect(prebuiltOf('{"main":"src/index.ts"}')).toBeUndefined();
  });
});
