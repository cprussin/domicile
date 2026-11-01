import { expect, test } from "bun:test";

import { sectionsOf } from "./sections";

test("lists a page's second-level headings in order, with the ids they render with", () => {
  const source = [
    "# Title",
    "## The `<app>` element",
    "### Sizing",
    "## Sizing",
    "<!-- tab: React -->",
    "## Focus",
  ].join("\n\n");
  expect(sectionsOf(source)).toEqual([
    { id: "the-app-element", title: "The <app> element" },
    // The `###` above took `sizing`, so this one is numbered, as on GitHub.
    { id: "sizing-1", title: "Sizing" },
    { id: "focus", title: "Focus" },
  ]);
});
