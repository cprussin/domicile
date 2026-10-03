import { describe, expect, it } from "bun:test";

import { importGraph, packageOf } from "./graph";

/** A disk of these files and nothing else. */
const disk =
  (files: Readonly<Record<string, string>>) =>
  (path: string): string | undefined =>
    files[path];

describe("importGraph", () => {
  it("follows the entry's relative imports, and names each package it imports", () => {
    const graph = importGraph(
      "/home/me/desk/domicile.tsx",
      disk({
        "/home/me/desk/domicile.tsx": `
          import { runManganese } from "@domicile-desktop/manganese";
          import { MailCount } from "./mail";
          export const Shell = runManganese({});
        `,
        "/home/me/desk/mail/index.tsx": `
          import { z } from "zod";
          import "./mail.css";
          export const MailCount = () => null;
        `,
        "/home/me/desk/mail/mail.css": "span { color: red; }",
      }),
    );

    expect([...graph.files.keys()].sort()).toEqual([
      "/home/me/desk/domicile.tsx",
      "/home/me/desk/mail/index.tsx",
      "/home/me/desk/mail/mail.css",
    ]);
    expect([...graph.packages].sort()).toEqual([
      "@domicile-desktop/manganese",
      "zod",
    ]);
  });

  it("refuses a relative import that names no file", () => {
    expect(() =>
      importGraph(
        "/desk/domicile.ts",
        disk({ "/desk/domicile.ts": `import "./gone";` }),
      ),
    ).toThrow("./gone");
  });
});

describe("packageOf", () => {
  it("is the package a bare specifier is in, scoped or not", () => {
    expect(packageOf("zod")).toBe("zod");
    expect(packageOf("zod/v4")).toBe("zod");
    expect(packageOf("@domicile-desktop/sdk/key-action")).toBe(
      "@domicile-desktop/sdk",
    );
  });
});
