import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { PAGES, pageAt, productOf, REPO_ROOT, sectionsFor } from "./pages";

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
    expect(pageAt(["manganese", "lock"])?.source).toBe(
      "docs/use/LOCK-AND-IDLE.md",
    );
  });

  test("nothing at a route no page has", () => {
    expect(pageAt(["manganese", "nope"])).toBeUndefined();
  });
});

describe("productOf", () => {
  test("is the product of the page's section", () => {
    expect(productOf("manganese/keys")).toBe("manganese");
    expect(productOf("shells/quickstart")).toBe("domicile");
  });

  test("throws for a route no page has", () => {
    expect(() => productOf("manganese/nope")).toThrow("/docs/manganese/nope");
  });
});

describe("sectionsFor", () => {
  test("is only that product's sections", () => {
    expect(
      sectionsFor("domicile").every(
        (section) => section.product === "domicile",
      ),
    ).toBe(true);
    expect(sectionsFor("manganese").map((section) => section.title)).toContain(
      "Get started",
    );
  });
});
