import { describe, expect, it } from "bun:test";

import { cacheKey, missingPackages, projectOf } from "./project";

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
        new Set(["@domicile/manganese", "react", "react-dom"]),
        undefined,
      ),
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
