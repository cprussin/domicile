import { describe, expect, it } from "bun:test";

import { Engine } from "../address/search";
import { Choice, choicesFor, launchOf } from "./choices";
import { fileRow } from "./file-row";
import { Launch } from "./launch";

/** A desktop entry, as the host sends it. */
const EDITOR = {
  command: ["gedit", "--new-window"],
  comment: "Edit text files",
  icon: undefined,
  id: "org.gnome.gedit.desktop",
  name: "Text Editor",
  preview: undefined,
};

/** A bookmark, as the host sends it. */
const MAIL = {
  icon: undefined,
  name: "Mail",
  url: "https://mail.example.com",
};

/** Sample file search results. */
const FOUND = ["Notes/", "Notes/today.org", "notes.org"];

const search = (query: string) =>
  Choice.Search(
    query,
    `https://google.com/search?q=${encodeURIComponent(query)}`,
  );

describe("choicesFor", () => {
  it("offers only the files for an empty box", () => {
    // An empty query has nothing to search for.
    expect(choicesFor("   ", FOUND, [], [])).toStrictEqual(
      FOUND.map(Choice.File),
    );
  });

  it("offers the files the host found, then a search for the words", () => {
    // The search is the fallback, even when a file matched.
    expect(choicesFor("today", ["Notes/today.org"], [], [])).toStrictEqual([
      Choice.File("Notes/today.org"),
      search("today"),
    ]);
  });

  it("offers a search alone for words no file matched", () => {
    expect(choicesFor("kate bush", [], [], [])).toStrictEqual([
      search("kate bush"),
    ]);
  });

  it("puts a URL first, then the files it matched, then a search", () => {
    // `notes.org` is both a domain and a file. The site ranks first.
    expect(choicesFor("notes.org", ["notes.org"], [], [])).toStrictEqual([
      Choice.Site("https://notes.org"),
      Choice.File("notes.org"),
      search("notes.org"),
    ]);
  });

  it("offers a tagged query on its engine first, then the rows it would get anyway", () => {
    // The tagged search ranks first. The rows for the line as typed follow,
    // with a Google search so it doesn't repeat the first row.
    expect(choicesFor("!wiki notes", ["Notes/"], [], [])).toStrictEqual([
      Choice.TaggedSearch({
        engine: Engine.Wikipedia,
        query: "notes",
        url: "https://en.wikipedia.org/wiki/Special:Search?search=notes",
      }),
      Choice.File("Notes/"),
      search("!wiki notes"),
    ]);
  });

  it("offers the page a !gh name goes to above the search for it", () => {
    expect(choicesFor("!gh cprussin", [], [], [])).toStrictEqual([
      Choice.TaggedSite({
        engine: Engine.GitHub,
        path: "cprussin",
        url: "https://github.com/cprussin",
      }),
      Choice.TaggedSearch({
        engine: Engine.GitHub,
        query: "cprussin",
        url: "https://github.com/search?q=cprussin",
      }),
      search("!gh cprussin"),
    ]);
  });

  it("offers a path spelled like one, whether or not the host found it", () => {
    // The host only searches home, so a path-like query gets its own row, on
    // top: it can't be a hostname or a search.
    expect(choicesFor("/etc/hosts", [], [], [])).toStrictEqual([
      Choice.File("/etc/hosts"),
      search("/etc/hosts"),
    ]);
  });

  it("offers the applications above the files, and a search below both", () => {
    expect(choicesFor("text", ["text.md"], [EDITOR], [])).toStrictEqual([
      Choice.App(EDITOR),
      Choice.File("text.md"),
      search("text"),
    ]);
  });

  it("offers the bookmarks among the applications, by name, above the files", () => {
    // Applications and bookmarks share one ranked list.
    const paint = { ...EDITOR, id: "paint.desktop", name: "Paint" };
    expect(
      choicesFor("", ["notes.org"], [paint, EDITOR], [MAIL]),
    ).toStrictEqual([
      Choice.Bookmark(MAIL),
      Choice.App(paint),
      Choice.App(EDITOR),
      Choice.File("notes.org"),
    ]);
  });

  it("puts a name that starts with the query first, application or bookmark", () => {
    const tea = { ...MAIL, name: "Tea Timer", url: "https://tea.example.com" };
    expect(choicesFor("te", [], [EDITOR], [tea]).slice(0, 2)).toStrictEqual([
      Choice.Bookmark(tea),
      Choice.App(EDITOR),
    ]);
    const meter = { ...MAIL, name: "Meter", url: "https://meter.example.com" };
    expect(choicesFor("te", [], [EDITOR], [meter]).slice(0, 2)).toStrictEqual([
      Choice.App(EDITOR),
      Choice.Bookmark(meter),
    ]);
  });

  it("offers the applications for an empty box, above the files", () => {
    expect(choicesFor("", ["notes.org"], [EDITOR], [])).toStrictEqual([
      Choice.App(EDITOR),
      Choice.File("notes.org"),
    ]);
  });

  it("offers a tagged query's rows above the applications", () => {
    expect(choicesFor("!gh text", [], [EDITOR], [])).toStrictEqual([
      Choice.TaggedSite({
        engine: Engine.GitHub,
        path: "text",
        url: "https://github.com/text",
      }),
      Choice.TaggedSearch({
        engine: Engine.GitHub,
        query: "text",
        url: "https://github.com/search?q=text",
      }),
      Choice.App(EDITOR),
      search("!gh text"),
    ]);
  });

  it("reads a typed ~/ as the home the host names its answers from", () => {
    // No duplicate when the host found it too.
    expect(choicesFor("~/notes.org", ["notes.org"], [], [])).toStrictEqual([
      Choice.File("notes.org"),
      search("~/notes.org"),
    ]);
  });
});

describe("launchOf", () => {
  it("edits a file, without the slash the host marks a directory with", () => {
    expect(launchOf(Choice.File("Notes/"))).toStrictEqual(
      Launch.Opened("Notes"),
    );
  });

  it("runs an application's command", () => {
    expect(launchOf(Choice.App(EDITOR))).toStrictEqual(
      Launch.Ran(["gedit", "--new-window"]),
    );
  });

  it("browses a bookmark's URL", () => {
    expect(launchOf(Choice.Bookmark(MAIL))).toStrictEqual(
      Launch.Browsed("https://mail.example.com"),
    );
  });

  it("browses a site, a tagged one, or any kind of search", () => {
    expect(launchOf(Choice.Site("https://example.com"))).toStrictEqual(
      Launch.Browsed("https://example.com"),
    );
    expect(
      launchOf(
        Choice.TaggedSite({
          engine: Engine.GitHub,
          path: "cprussin",
          url: "https://github.com/cprussin",
        }),
      ),
    ).toStrictEqual(Launch.Browsed("https://github.com/cprussin"));
    expect(launchOf(search("kate bush"))).toStrictEqual(
      Launch.Browsed("https://google.com/search?q=kate%20bush"),
    );
    expect(
      launchOf(
        Choice.TaggedSearch({
          engine: Engine.YouTube,
          query: "kate bush",
          url: "https://www.youtube.com/results?search_query=kate%20bush",
        }),
      ),
    ).toStrictEqual(
      Launch.Browsed(
        "https://www.youtube.com/results?search_query=kate%20bush",
      ),
    );
  });
});

describe("Choice.File", () => {
  it("is the row the host's path draws as", () => {
    expect(Choice.File("Notes/").row).toStrictEqual(fileRow("Notes/"));
  });
});
