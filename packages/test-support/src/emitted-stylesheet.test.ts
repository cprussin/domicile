import { describe, expect, it } from "bun:test";

import { loadEmittedStylesheet } from "./emitted-stylesheet";

const fixture = new URL("fixtures/stylesheet.css", import.meta.url);

const styled = (): number =>
  [...document.head.querySelectorAll("style")].filter((element) =>
    element.textContent?.includes("fixture-wide"),
  ).length;

describe("loadEmittedStylesheet", () => {
  describe("in a describe", () => {
    loadEmittedStylesheet(document, fixture);

    it("styles the document for its tests", () => {
      expect(styled()).toBe(1);
    });
  });

  // Test files share one document, so a stylesheet left behind slows every
  // later file's style lookups.
  it("takes it out again once they have run", () => {
    expect(styled()).toBe(0);
  });
});
