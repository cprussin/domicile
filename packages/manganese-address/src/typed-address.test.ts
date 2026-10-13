import { describe, expect, it } from "bun:test";

import { TypedAddress, typedAddress } from "./typed-address";

describe("typedAddress", () => {
  describe("a site", () => {
    it("takes an address that names its own scheme at its word", () => {
      expect(typedAddress("https://wayland.freedesktop.org")).toStrictEqual(
        TypedAddress.Site("https://wayland.freedesktop.org"),
      );
    });

    it("takes a scheme that carries no authority too", () => {
      // No `//` follows the colon, so the named list of bare schemes decides.
      // A bare `note:` is a search.
      expect(typedAddress("about:blank")).toStrictEqual(
        TypedAddress.Site("about:blank"),
      );
      expect(typedAddress("domicile://shell/")).toStrictEqual(
        TypedAddress.Site("domicile://shell/"),
      );
    });

    it("loads a bare host over https", () => {
      // No scheme typed; https, not http, to avoid the insecure guess.
      expect(typedAddress("news.ycombinator.com")).toStrictEqual(
        TypedAddress.Site("https://news.ycombinator.com"),
      );
    });

    it("loads a host with a path on it", () => {
      expect(typedAddress("github.com/cprussin/domicile")).toStrictEqual(
        TypedAddress.Site("https://github.com/cprussin/domicile"),
      );
    });

    it("loads a host under any TLD that exists", () => {
      expect(typedAddress("claude.ai/code")).toStrictEqual(
        TypedAddress.Site("https://claude.ai/code"),
      );
    });

    it("loads localhost, which has no dot to recognize it by", () => {
      expect(typedAddress("localhost:5173")).toStrictEqual(
        TypedAddress.Site("https://localhost:5173"),
      );
    });
  });

  describe("a search", () => {
    it("searches for words", () => {
      expect(typedAddress("how tall is a giraffe")).toStrictEqual(
        TypedAddress.Search(
          "how tall is a giraffe",
          "https://google.com/search?q=how%20tall%20is%20a%20giraffe",
        ),
      );
    });

    it("searches rather than loading when a dot is inside a sentence", () => {
      // The TLD list tells a sentence from a host: `end.Then` is not a TLD.
      expect(typedAddress("the sentence ends. Then another")).toStrictEqual(
        TypedAddress.Search(
          "the sentence ends. Then another",
          "https://google.com/search?q=the%20sentence%20ends.%20Then%20another",
        ),
      );
    });

    it("sends a tagged query to the engine the tag names", () => {
      expect(typedAddress("!wiki mesa")).toStrictEqual(
        TypedAddress.Search(
          "!wiki mesa",
          "https://en.wikipedia.org/wiki/Special:Search?search=mesa",
        ),
      );
    });
  });

  it("answers nothing for a query with nothing in it", () => {
    // Enter on an empty box does nothing; any answer would be worse.
    expect(typedAddress("   ")).toBeUndefined();
  });
});
