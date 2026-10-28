import { describe, expect, it } from "bun:test";

import { cacheKey, missingPackages, projectOf, viteConfigOf } from "./project";

describe("projectOf", () => {
  it("is the nearest directory above the entry with a package.json", () => {
    const has = new Set(["/home/me/desk/package.json"]);
    expect(
      projectOf("/home/me/desk/bar/domicile.tsx", (file) => has.has(file)),
    ).toBe("/home/me/desk");
  });

  it("is the entry's own directory where nothing above has one", () => {
    expect(projectOf("/home/me/desk/domicile.tsx", () => false)).toBe(
      "/home/me/desk",
    );
  });
});

describe("viteConfigOf", () => {
  it("is the project's vite config", () => {
    const has = new Set(["/home/me/desk/vite.config.mts"]);
    expect(viteConfigOf("/home/me/desk", (file) => has.has(file))).toBe(
      "/home/me/desk/vite.config.mts",
    );
  });

  it("is `undefined` for a project without one", () => {
    expect(viteConfigOf("/home/me/desk", () => false)).toBeUndefined();
  });
});

describe("missingPackages", () => {
  it("is what the entry imports that the project does not list", () => {
    expect(
      missingPackages(new Set(["zod", "date-fns"]), {
        dependencies: { zod: "^4" },
      }),
    ).toEqual(["date-fns"]);
  });

  it("never asks for Domicile's own packages or React, which come from Domicile", () => {
    expect(
      missingPackages(
        new Set(["@domicile-desktop/manganese", "react", "react-dom"]),
        undefined,
      ),
    ).toEqual([]);
  });

  // A vite config commonly imports `node:path`.
  it("never asks for the runtime's built-in modules", () => {
    expect(
      missingPackages(new Set(["node:path", "path", "bun"]), undefined),
    ).toEqual([]);
  });
});

describe("cacheKey", () => {
  const files = new Map([
    ["/desk/a.ts", "a"],
    ["/desk/b.ts", "b"],
  ]);

  it("is the same for the same files, lockfile and Domicile", () => {
    expect(cacheKey(files, "lock", "1")).toBe(
      cacheKey(new Map([...files].reverse()), "lock", "1"),
    );
  });

  it("moves with any file, the lockfile, or Domicile", () => {
    const key = cacheKey(files, "lock", "1");
    expect(
      cacheKey(new Map([...files, ["/desk/b.ts", "c"]]), "lock", "1"),
    ).not.toBe(key);
    expect(cacheKey(files, "lock2", "1")).not.toBe(key);
    expect(cacheKey(files, "lock", "2")).not.toBe(key);
  });
});
