import { describe, expect, it } from "bun:test";

import { highlight } from "./highlight";

describe(highlight, () => {
  it("marks each search word, ignoring case", () => {
    expect(highlight("Cats and Dogs", "dog cat")).toEqual([
      { marked: true, text: "Cat" },
      { marked: false, text: "s and " },
      { marked: true, text: "Dog" },
      { marked: false, text: "s" },
    ]);
  });

  it("marks nothing without a search", () => {
    expect(highlight("Cats", " ")).toEqual([{ marked: false, text: "Cats" }]);
  });

  it("reads regular expression characters literally", () => {
    expect(highlight("a.b", ".")).toEqual([
      { marked: false, text: "a" },
      { marked: true, text: "." },
      { marked: false, text: "b" },
    ]);
  });
});
