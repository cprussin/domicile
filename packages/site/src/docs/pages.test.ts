import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { PAGES, pageAt, REPO_ROOT } from "./pages";

describe("the docs pages", () => {
  test("every page renders a file that exists", () => {
    expect(
      PAGES.filter((page) => !existsSync(join(REPO_ROOT, page.source))),
    ).toEqual([]);
  });

  test("no two pages share a route", () => {
    expect(new Set(PAGES.map((page) => page.slug)).size).toBe(PAGES.length);
  });
});

describe("pageAt", () => {
  test("finds a page by its route's segments", () => {
    expect(pageAt(["manganese", "lock"])?.source).toBe("docs/LOCK.md");
  });

  test("nothing at a route no page has", () => {
    expect(pageAt(["manganese", "nope"])).toBeUndefined();
  });
});
