import { describe, expect, it } from "bun:test";

import { Choice, choicesFor, launchOf } from "./choices";
import { fileRow } from "./file-row";
import { Launch } from "./launch";

/** What a home might have in it, as the host would have answered. */
const FOUND = ["Notes/", "Notes/today.org", "notes.org"];

const search = (query: string) =>
  Choice.Search(
    query,
    `https://google.com/search?q=${encodeURIComponent(query)}`,
  );

describe("choicesFor", () => {
  it("offers only the files for an empty box", () => {
    // Enter on an empty box is a keystroke nobody meant as a command, and a
    // search for the empty string is not a row anybody wants.
    expect(choicesFor("   ", FOUND)).toStrictEqual(FOUND.map(Choice.File));
  });

  it("offers the files the host found, then a search for the words", () => {
    // Always a search, even for a name that matched: the file is what was
    // probably meant and the search is what is left if it was not.
    expect(choicesFor("today", ["Notes/today.org"])).toStrictEqual([
      Choice.File("Notes/today.org"),
      search("today"),
    ]);
  });

  it("offers a search alone for words no file matched", () => {
    expect(choicesFor("kate bush", [])).toStrictEqual([search("kate bush")]);
  });

  it("puts a URL first, then the files it matched, then a search", () => {
    // `notes.org` is a real domain and, here, a real file. Both are offered,
    // and the site is on top: a URL typed whole is a URL meant.
    expect(choicesFor("notes.org", ["notes.org"])).toStrictEqual([
      Choice.Site("https://notes.org"),
      Choice.File("notes.org"),
      search("notes.org"),
    ]);
  });

  it("sends a tagged query to the engine the tag names", () => {
    expect(choicesFor("!wiki mesa", [])).toStrictEqual([
      Choice.Search(
        "!wiki mesa",
        "https://en.wikipedia.org/wiki/Special:Search?search=mesa",
      ),
    ]);
  });

  it("offers a path spelled like one, whether or not the host found it", () => {
    // The list is what a home has in it, not what exists: `/etc/hosts` is not
    // under home and is still a file. A leading `/`, `./`, `../` or `~/`
    // cannot be a hostname or a search anybody meant — so it goes on top.
    expect(choicesFor("/etc/hosts", [])).toStrictEqual([
      Choice.File("/etc/hosts"),
      search("/etc/hosts"),
    ]);
  });

  it("reads a typed ~/ as the home the host names its answers from", () => {
    // And does not offer it twice when the host found it too.
    expect(choicesFor("~/notes.org", ["notes.org"])).toStrictEqual([
      Choice.File("notes.org"),
      search("~/notes.org"),
    ]);
  });
});

describe("launchOf", () => {
  it("edits a file, without the slash the host marks a directory with", () => {
    expect(launchOf(Choice.File("Notes/"))).toStrictEqual(
      Launch.Edited("Notes"),
    );
  });

  it("browses a site or a search", () => {
    expect(launchOf(Choice.Site("https://example.com"))).toStrictEqual(
      Launch.Browsed("https://example.com"),
    );
    expect(launchOf(search("kate bush"))).toStrictEqual(
      Launch.Browsed("https://google.com/search?q=kate%20bush"),
    );
  });
});

describe("Choice.File", () => {
  it("is the row the host's path draws as", () => {
    expect(Choice.File("Notes/").row).toStrictEqual(fileRow("Notes/"));
  });
});
