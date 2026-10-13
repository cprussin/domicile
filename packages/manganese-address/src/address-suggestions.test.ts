import { describe, expect, it } from "bun:test";

import { AddressSuggestion, addressSuggestions } from "./address-suggestions";

/** Where a window has been, oldest first. */
const VISITED = [
  "https://example.com",
  "https://docs.example.com/guide",
  "https://news.ycombinator.com",
];

describe("addressSuggestions", () => {
  describe("with nothing typed", () => {
    it("offers where the window has been, most recent first", () => {
      // On focus the user is most likely going back to a recent page.
      expect(addressSuggestions("", VISITED)).toStrictEqual([
        AddressSuggestion.Visited("https://news.ycombinator.com"),
        AddressSuggestion.Visited("https://docs.example.com/guide"),
        AddressSuggestion.Visited("https://example.com"),
      ]);
    });

    it("offers nothing at all when the window has been nowhere", () => {
      expect(addressSuggestions("  ", [])).toStrictEqual([]);
    });
  });

  describe("with something typed", () => {
    // What Enter would do always comes first, as in Chromium.
    it("leads with the address the typed line would load", () => {
      expect(addressSuggestions("docs.example.com", VISITED)[0]).toStrictEqual(
        AddressSuggestion.Site("https://docs.example.com"),
      );
    });

    it("leads with the search the typed line would run when it is not an address", () => {
      expect(
        addressSuggestions("how tall is a giraffe", VISITED),
      ).toStrictEqual([
        AddressSuggestion.Search(
          "how tall is a giraffe",
          "https://google.com/search?q=how%20tall%20is%20a%20giraffe",
        ),
      ]);
    });

    it("offers the places it has been that the typed line appears in", () => {
      expect(addressSuggestions("example", VISITED)).toStrictEqual([
        AddressSuggestion.Search(
          "example",
          "https://google.com/search?q=example",
        ),
        AddressSuggestion.Visited("https://docs.example.com/guide"),
        AddressSuggestion.Visited("https://example.com"),
      ]);
    });

    it("matches without regard to case, the way an address bar does", () => {
      expect(addressSuggestions("YCOMBINATOR", VISITED)).toContainEqual(
        AddressSuggestion.Visited("https://news.ycombinator.com"),
      );
    });

    it("offers a visited address once, not twice", () => {
      // Otherwise the same URL would appear twice, once as Enter's action and
      // once as a visit.
      const suggestions = addressSuggestions("https://example.com", VISITED);

      expect(suggestions).toStrictEqual([
        AddressSuggestion.Site("https://example.com"),
      ]);
    });

    it("keeps the list a list rather than a history", () => {
      // Lines past the first few are rarely the answer.
      const many = Array.from(
        { length: 30 },
        (_, index) => `https://example.com/${index.toString()}`,
      );

      expect(addressSuggestions("example.com/", many).length).toBeLessThan(8);
    });
  });
});
