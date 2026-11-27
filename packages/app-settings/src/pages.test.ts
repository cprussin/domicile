import { describe, expect, it } from "bun:test";

import { PAGES, PageId, pageName, pageNamed } from "./pages";

describe(pageNamed, () => {
  it("finds a page by its name in the address", () => {
    expect(pageNamed("#privacy")).toBe(PageId.Privacy);
    expect(pageNamed("#site-data")).toBe(PageId.SiteData);
    expect(pageNamed("#Privacy")).toBe(PageId.Privacy);
  });

  it("finds none for no name or one no page has", () => {
    expect(pageNamed("")).toBeUndefined();
    expect(pageNamed("#")).toBeUndefined();
    expect(pageNamed("#nowhere")).toBeUndefined();
  });

  it("finds every page by its own name", () => {
    for (const page of PAGES) {
      expect(pageNamed(`#${pageName(page.id)}`)).toBe(page.id);
    }
  });
});
