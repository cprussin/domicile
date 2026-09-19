import { describe, expect, it } from "bun:test";

import { Launch, launchFor } from "./launch";

/** What a home might have in it, as the host would have answered. */
const OFFERED = ["Notes/today.org", "notes.org", "src", "src/domicile"];

describe("launchFor", () => {
  describe("a file", () => {
    it("edits a path the host offered", () => {
      expect(launchFor("Notes/today.org", OFFERED)).toStrictEqual(
        Launch.Edited("Notes/today.org"),
      );
    });

    it("edits a path the host did not offer but that is spelled like one", () => {
      // The list is what a home has in it, not what exists: `/etc/hosts` is
      // not under home and is still a file. A leading slash is the one thing
      // that cannot be anything else, so it is taken at its word.
      expect(launchFor("/etc/hosts", OFFERED)).toStrictEqual(
        Launch.Edited("/etc/hosts"),
      );
    });

    it("reads a typed ~/ as the home the host named its answers from", () => {
      // The host answers in paths relative to home, so that is what the rest
      // of the desktop speaks — and `~/` is how a person spells the same
      // thing. Normalized here so nothing downstream has two spellings of one
      // path to handle.
      expect(launchFor("~/Notes/today.org", OFFERED)).toStrictEqual(
        Launch.Edited("Notes/today.org"),
      );
    });

    it("prefers a file to the site it could be read as", () => {
      // `notes.org` is a real domain and, here, a real file. The file wins,
      // because the list is evidence and the domain is a guess — which is the
      // same order `run` puts them in by testing for the file first.
      expect(launchFor("notes.org", OFFERED)).toStrictEqual(
        Launch.Edited("notes.org"),
      );
    });
  });

  describe("a URL", () => {
    it("browses an address that names its own scheme", () => {
      expect(
        launchFor("https://wayland.freedesktop.org", OFFERED),
      ).toStrictEqual(Launch.Browsed("https://wayland.freedesktop.org"));
    });

    it("browses a bare host under https", () => {
      // What a person types when they mean a site: no scheme, because nobody
      // types a scheme. https rather than http, because a desktop should not
      // make the insecure guess on the user's behalf.
      expect(launchFor("news.ycombinator.com", OFFERED)).toStrictEqual(
        Launch.Browsed("https://news.ycombinator.com"),
      );
    });

    it("browses a host with a path on it", () => {
      expect(launchFor("github.com/cprussin/domicile", OFFERED)).toStrictEqual(
        Launch.Browsed("https://github.com/cprussin/domicile"),
      );
    });

    it("browses localhost, which has no dot to recognize it by", () => {
      // The one hostname with no TLD that a person types on purpose, and the
      // one this desktop's user types most.
      expect(launchFor("localhost:5173", OFFERED)).toStrictEqual(
        Launch.Browsed("https://localhost:5173"),
      );
    });
  });

  describe("anything else", () => {
    it("searches for words", () => {
      expect(launchFor("how tall is a giraffe", OFFERED)).toStrictEqual(
        Launch.Browsed(
          "https://google.com/search?q=how%20tall%20is%20a%20giraffe",
        ),
      );
    });

    it("searches rather than browsing when a dot is inside a sentence", () => {
      // A sentence with a full stop in it is not a hostname, and the TLD list
      // is what tells them apart: `end.Then` ends in nothing anybody
      // registers.
      expect(
        launchFor("the sentence ends. Then another", OFFERED),
      ).toStrictEqual(
        Launch.Browsed(
          "https://google.com/search?q=the%20sentence%20ends.%20Then%20another",
        ),
      );
    });

    it("sends a tagged query to the engine the tag names", () => {
      expect(launchFor("!wiki mesa", OFFERED)).toStrictEqual(
        Launch.Browsed(
          "https://en.wikipedia.org/wiki/Special:Search?search=mesa",
        ),
      );
    });
  });

  it("refuses an empty query rather than launching something arbitrary", () => {
    // Enter on an empty box is a keystroke nobody meant as a command. The
    // alternatives are all worse than nothing: a search for the empty string,
    // or an editor on the home directory.
    expect(launchFor("   ", OFFERED)).toBeUndefined();
  });
});
