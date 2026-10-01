import { describe, expect, it } from "bun:test";

import { highlight, languageOf } from "./highlight";

describe("languageOf", () => {
  it("reads a language from an extension, or from a name with none", () => {
    expect(languageOf("src/main.TS")).toBe("ts");
    expect(languageOf("Makefile")).toBe("makefile");
    expect(languageOf("Notes/today.org")).toBe("org");
  });

  it("is nothing for a file no grammar is for, or for plain text", () => {
    expect(languageOf("todo.txt")).toBeUndefined();
    expect(languageOf(".bashrc")).toBeUndefined();
  });
});

describe("highlight", () => {
  it("cuts text in a language into lines of runs, each with what it is", () => {
    expect(highlight("typescript", 'const a = "b";\nf()')).toStrictEqual([
      [
        { scope: "keyword", text: "const" },
        { scope: undefined, text: " a = " },
        { scope: "string", text: '"b"' },
        { scope: undefined, text: ";" },
      ],
      [
        { scope: "title", text: "f" },
        { scope: undefined, text: "()" },
      ],
    ]);
  });

  it("gives a run inside another the scope nearest it", () => {
    expect(highlight("typescript", "`a${b}`")).toStrictEqual([
      [
        { scope: "string", text: "`a" },
        { scope: "subst", text: "${b}" },
        { scope: "string", text: "`" },
      ],
    ]);
  });

  it("lights an org file's outline, markup and metadata", () => {
    expect(
      highlight(
        "org",
        [
          "#+title: Today",
          "* TODO Write *it* :work:",
          "  SCHEDULED: <2026-10-01 Thu>",
          "  - [X] see [[https://a.b][a]] or =c=",
          "  :ID: /a/ ~b~ +c+",
          "# not run",
        ].join("\n"),
      ),
    ).toStrictEqual([
      [
        { scope: "meta", text: "#+title:" },
        { scope: undefined, text: " Today" },
      ],
      [
        { scope: "section", text: "* " },
        { scope: "keyword", text: "TODO" },
        { scope: "section", text: " Write " },
        { scope: "strong", text: "*it*" },
        { scope: "section", text: " " },
        { scope: "symbol", text: ":work:" },
      ],
      [
        { scope: undefined, text: "  " },
        { scope: "keyword", text: "SCHEDULED:" },
        { scope: undefined, text: " " },
        { scope: "number", text: "<2026-10-01 Thu>" },
      ],
      [
        { scope: "bullet", text: "  - " },
        { scope: "literal", text: "[X]" },
        { scope: undefined, text: " see " },
        { scope: "link", text: "[[https://a.b][a]]" },
        { scope: undefined, text: " or " },
        { scope: "string", text: "=c=" },
      ],
      [
        { scope: "attr", text: "  :ID:" },
        { scope: undefined, text: " " },
        { scope: "emphasis", text: "/a/" },
        { scope: undefined, text: " " },
        { scope: "string", text: "~b~" },
        { scope: undefined, text: " " },
        { scope: "deletion", text: "+c+" },
      ],
      [{ scope: "comment", text: "# not run" }],
    ]);
  });

  it("keeps a line nothing is on, but not the one a last newline opens", () => {
    expect(highlight(undefined, "a\n\nb\n")).toStrictEqual([
      [{ scope: undefined, text: "a" }],
      [],
      [{ scope: undefined, text: "b" }],
    ]);
  });
});
