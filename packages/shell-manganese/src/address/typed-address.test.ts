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
      // `about:blank` is an address a person types on purpose and no
      // authority follows the colon, so the `//` a network scheme has is not
      // what says this is an address. The named set is what says it: a bare
      // `note:` is a word with a colon after it and goes to a search.
      expect(typedAddress("about:blank")).toStrictEqual(
        TypedAddress.Site("about:blank"),
      );
      expect(typedAddress("domicile://shell/")).toStrictEqual(
        TypedAddress.Site("domicile://shell/"),
      );
    });

    it("loads a bare host over https", () => {
      // What a person types when they mean a site: no scheme, because nobody
      // types a scheme. https rather than http, because an address bar should
      // not make the insecure guess on the user's behalf.
      expect(typedAddress("news.ycombinator.com")).toStrictEqual(
        TypedAddress.Site("https://news.ycombinator.com"),
      );
    });

    it("loads a host with a path on it", () => {
      expect(typedAddress("github.com/cprussin/domicile")).toStrictEqual(
        TypedAddress.Site("https://github.com/cprussin/domicile"),
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
      // A sentence with a full stop in it is not a hostname, and the TLD list
      // is what tells them apart: `end.Then` ends in nothing anybody
      // registers.
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
    // Enter on an empty box is a keystroke nobody meant as a command, and
    // every way of answering it — a search for the empty string, a reload of
    // the home page — is worse than not answering.
    expect(typedAddress("   ")).toBeUndefined();
  });
});
