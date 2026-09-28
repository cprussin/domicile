import { describe, expect, it } from "bun:test";

import { highlight, languageOf } from "./highlight";

describe("languageOf", () => {
  it("reads a language from an extension, or from a name with none", () => {
    expect(languageOf("src/main.TS")).toBe("ts");
    expect(languageOf("Makefile")).toBe("makefile");
  });

  it("is nothing for a file no grammar is for, or for plain text", () => {
    expect(languageOf("Notes/today.org")).toBeUndefined();
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

  it("keeps a line nothing is on, but not the one a last newline opens", () => {
    expect(highlight(undefined, "a\n\nb\n")).toStrictEqual([
      [{ scope: undefined, text: "a" }],
      [],
      [{ scope: undefined, text: "b" }],
    ]);
  });
});
