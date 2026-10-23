import { describe, expect, test } from "bun:test";

import { highlight } from "./highlight";

describe("highlight", () => {
  test("splits code into lines", () => {
    expect(highlight("plain", "one\ntwo\n")).toEqual([
      [{ text: "one", tone: "plain" }],
      [{ text: "two", tone: "plain" }],
    ]);
  });

  test("keeps an empty line in the middle", () => {
    expect(highlight("plain", "one\n\ntwo")).toEqual([
      [{ text: "one", tone: "plain" }],
      [],
      [{ text: "two", tone: "plain" }],
    ]);
  });

  test("colors a keyword and a string", () => {
    const [line] = highlight("tsx", 'const name = "domicile";');
    expect(line).toContainEqual({ text: "const", tone: "keyword" });
    expect(line).toContainEqual({ text: '"domicile"', tone: "string" });
  });

  test("colors a CSS property and a number", () => {
    const lines = highlight("css", "main {\n  gap: 10px;\n}");
    expect(lines[1]).toContainEqual({ text: "gap", tone: "property" });
    expect(lines[1]).toContainEqual({ text: "10px", tone: "number" });
  });

  test("a scope spanning lines colors each line", () => {
    const lines = highlight("css", "/* one\ntwo */");
    expect(lines).toEqual([
      [{ text: "/* one", tone: "comment" }],
      [{ text: "two */", tone: "comment" }],
    ]);
  });
});
