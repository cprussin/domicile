import { describe, expect, it } from "bun:test";

import { indent, newline, outdent } from "./editing";

describe(indent, () => {
  it("puts two spaces at the cursor", () => {
    expect(indent({ end: 3, start: 3, text: "abcdef" })).toEqual({
      end: 5,
      start: 5,
      text: "abc  def",
    });
  });

  it("indents every line a selection touches", () => {
    expect(indent({ end: 6, start: 1, text: "ab\ncd\nef" })).toEqual({
      end: 12,
      start: 3,
      text: "  ab\n  cd\n  ef",
    });
  });
});

describe(outdent, () => {
  it("takes up to two spaces off every line a selection touches", () => {
    expect(outdent({ end: 9, start: 4, text: "  ab\n cd\nef" })).toEqual({
      end: 6,
      start: 2,
      text: "ab\ncd\nef",
    });
  });
});

describe(newline, () => {
  it("starts the new line as indented as the one it breaks", () => {
    expect(newline({ end: 8, start: 8, text: "a\n    bcd" })).toEqual({
      end: 13,
      start: 13,
      text: "a\n    bc\n    d",
    });
  });

  it("replaces a selection", () => {
    expect(newline({ end: 3, start: 1, text: "abcd" })).toEqual({
      end: 2,
      start: 2,
      text: "a\nd",
    });
  });
});
