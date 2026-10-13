import { describe, expect, it } from "bun:test";

import { highlight } from "./highlight";

/** `lines` of an Org file, as the preview lights them. */
const org = (...lines: string[]) => highlight("org", lines.join("\n"));

describe("org", () => {
  describe("headlines", () => {
    it("lights four levels apart, and a fifth like the first", () => {
      expect(org("* a", "** b", "*** c", "**** d", "***** e")).toStrictEqual([
        [{ scope: "heading-1", text: "* a" }],
        [{ scope: "heading-2", text: "** b" }],
        [{ scope: "heading-3", text: "*** c" }],
        [{ scope: "heading-4", text: "**** d" }],
        [{ scope: "heading-1", text: "***** e" }],
      ]);
    });

    it("lights a headline's keyword, priority, cookie, markup and tags", () => {
      expect(org("** TODO [#A] Write *it* [1/2] :work:home:")).toStrictEqual([
        [
          { scope: "heading-2", text: "** " },
          { scope: "todo", text: "TODO" },
          { scope: "heading-2", text: " " },
          { scope: "priority", text: "[#A]" },
          { scope: "heading-2", text: " Write " },
          { scope: "strong", text: "*it*" },
          { scope: "heading-2", text: " " },
          { scope: "literal", text: "[1/2]" },
          { scope: "heading-2", text: " " },
          { scope: "tag", text: ":work:home:" },
        ],
      ]);
    });

    it("quiets a headline that is done, whatever its level", () => {
      expect(org("*** DONE Ship :x:", "* CANCELED Not")).toStrictEqual([
        [
          { scope: "heading-done", text: "*** " },
          { scope: "done", text: "DONE" },
          { scope: "heading-done", text: " Ship " },
          { scope: "tag", text: ":x:" },
        ],
        [
          { scope: "heading-done", text: "* " },
          { scope: "done", text: "CANCELED" },
          { scope: "heading-done", text: " Not" },
        ],
      ]);
    });
  });

  it("lights a drawer's delimiters, its properties and their values", () => {
    expect(
      org(
        ":PROPERTIES:",
        "  :ID: abc-1",
        ":END:",
        "  CLOCK: [2026-10-01 Thu 09:00]",
      ),
    ).toStrictEqual([
      [{ scope: "meta", text: ":PROPERTIES:" }],
      [
        { scope: "attr", text: "  :ID:" },
        { scope: undefined, text: " " },
        { scope: "string", text: "abc-1" },
      ],
      [{ scope: "meta", text: ":END:" }],
      [
        { scope: undefined, text: "  " },
        { scope: "keyword", text: "CLOCK:" },
        { scope: undefined, text: " " },
        { scope: "number", text: "[2026-10-01 Thu 09:00]" },
      ],
    ]);
  });

  it("lights a keyword line, its value, and a title's as the title", () => {
    expect(org("#+title: Today", "#+author: Me")).toStrictEqual([
      [
        { scope: "meta", text: "#+title:" },
        { scope: undefined, text: " " },
        { scope: "title", text: "Today" },
      ],
      [
        { scope: "meta", text: "#+author:" },
        { scope: undefined, text: " " },
        { scope: "string", text: "Me" },
      ],
    ]);
  });

  describe("blocks", () => {
    it("lights a source block in its own language", () => {
      expect(org("#+BEGIN_SRC ts", "const a", "#+END_SRC")).toStrictEqual([
        [{ scope: "meta", text: "#+BEGIN_SRC ts" }],
        [
          { scope: "keyword", text: "const" },
          { scope: undefined, text: " a" },
        ],
        [{ scope: "meta", text: "#+END_SRC" }],
      ]);
    });

    it("reads nothing inside another block as Org", () => {
      expect(
        org("#+begin_example", "* not a headline", "#+end_example"),
      ).toStrictEqual([
        [{ scope: "meta", text: "#+begin_example" }],
        [{ scope: undefined, text: "* not a headline" }],
        [{ scope: "meta", text: "#+end_example" }],
      ]);
    });
  });

  it("lights a table's rules and borders apart from its cells", () => {
    expect(org("| a | *b* |", "|---+---|")).toStrictEqual([
      [
        { scope: "punctuation", text: "|" },
        { scope: "table", text: " a " },
        { scope: "punctuation", text: "|" },
        { scope: "table", text: " " },
        { scope: "strong", text: "*b*" },
        { scope: "table", text: " " },
        { scope: "punctuation", text: "|" },
      ],
      [{ scope: "punctuation", text: "|---+---|" }],
    ]);
  });

  it("lights lists, links, footnotes, rules, markup and comments", () => {
    expect(
      org(
        "  - [X] see [[https://a.b][a]][fn:1] or =c=",
        "  1. /a/ ~b~ +c+",
        "-----",
        "# not run",
      ),
    ).toStrictEqual([
      [
        { scope: "bullet", text: "  - " },
        { scope: "literal", text: "[X]" },
        { scope: undefined, text: " see " },
        { scope: "link", text: "[[https://a.b][a]]" },
        { scope: "link", text: "[fn:1]" },
        { scope: undefined, text: " or " },
        { scope: "string", text: "=c=" },
      ],
      [
        { scope: "bullet", text: "  1. " },
        { scope: "emphasis", text: "/a/" },
        { scope: undefined, text: " " },
        { scope: "string", text: "~b~" },
        { scope: undefined, text: " " },
        { scope: "deletion", text: "+c+" },
      ],
      [{ scope: "punctuation", text: "-----" }],
      [{ scope: "comment", text: "# not run" }],
    ]);
  });
});
