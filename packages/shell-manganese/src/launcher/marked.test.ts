import { describe, expect, it } from "bun:test";
import { marked } from "./marked";

describe("marked", () => {
  it("leaves a line nobody has narrowed in one piece", () => {
    expect(marked("Notes/today.org", "  ")).toStrictEqual([
      { matched: false, text: "Notes/today.org" },
    ]);
  });

  it("cuts out what a word matched, in the case it was written in", () => {
    expect(marked("Notes/today.org", "notes")).toStrictEqual([
      { matched: true, text: "Notes" },
      { matched: false, text: "/today.org" },
    ]);
  });

  it("marks every word of the query, and every place it appears", () => {
    expect(marked("Notes/2026/notes.org", "notes org")).toStrictEqual([
      { matched: true, text: "Notes" },
      { matched: false, text: "/2026/" },
      { matched: true, text: "notes" },
      { matched: false, text: "." },
      { matched: true, text: "org" },
    ]);
  });

  it("joins words that matched over the same letters", () => {
    // `fzf --exact` asks that every word appear, not that they appear apart —
    // so `note notes` is a query that matches, and two runs meeting in the
    // middle of a name would draw a seam nothing put there.
    expect(marked("notes.org", "note notes")).toStrictEqual([
      { matched: true, text: "notes" },
      { matched: false, text: ".org" },
    ]);
  });
});
