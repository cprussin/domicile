import { describe, expect, test } from "bun:test";

import { resolveHref } from "./links";

const PAGES = [
  { slug: "manganese/lock", source: "docs/LOCK.md" },
  { slug: "manganese/keys", source: "packages/wm/docs/KEYS.md" },
];

describe("resolveHref", () => {
  test("a page beside it becomes its route", () => {
    expect(resolveHref("IDLE.md", "docs/LOCK.md", PAGES)).toBe(
      "https://github.com/cprussin/domicile/blob/stable/docs/IDLE.md",
    );
    expect(resolveHref("LOCK.md#verifiers", "docs/IDLE.md", PAGES)).toBe(
      "/docs/manganese/lock#verifiers",
    );
  });

  test("a relative path climbs out of its directory", () => {
    expect(
      resolveHref("../../../docs/LOCK.md", "packages/wm/docs/KEYS.md", PAGES),
    ).toBe("/docs/manganese/lock");
  });

  test("a path from the root is the repository's", () => {
    expect(
      resolveHref("/packages/wm/docs/KEYS.md", "docs/LOCK.md", PAGES),
    ).toBe("/docs/manganese/keys");
  });

  test("a file the docs don't render links to GitHub", () => {
    expect(resolveHref("src/", "packages/wm/docs/KEYS.md", PAGES)).toBe(
      "https://github.com/cprussin/domicile/blob/stable/packages/wm/docs/src/",
    );
  });

  test("anchors and other sites stay as they are", () => {
    expect(resolveHref("#sleep", "docs/LOCK.md", PAGES)).toBe("#sleep");
    expect(resolveHref("https://sway.org", "docs/LOCK.md", PAGES)).toBe(
      "https://sway.org",
    );
    expect(resolveHref("mailto:a@b.c", "docs/LOCK.md", PAGES)).toBe(
      "mailto:a@b.c",
    );
  });
});
