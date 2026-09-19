import { describe, expect, it } from "bun:test";

import { matching } from "./matching";

const OFFERED = [
  "Notes/2026/april.org",
  "Notes/today.org",
  "src/domicile",
  "todo.txt",
];

describe("matching", () => {
  it("offers everything before anything has been typed", () => {
    expect(matching(OFFERED, "")).toStrictEqual(OFFERED);
  });

  it("keeps the rows whose path contains what was typed", () => {
    expect(matching(OFFERED, "org")).toStrictEqual([
      "Notes/2026/april.org",
      "Notes/today.org",
    ]);
  });

  it("ignores case, because a path's does not survive being remembered", () => {
    expect(matching(OFFERED, "notes/TODAY")).toStrictEqual(["Notes/today.org"]);
  });

  it("requires every word, in any order and anywhere in the path", () => {
    // fzf's `--exact` with several terms, which is what the launcher this one
    // is modelled on runs: each word narrows, and none of them has to be next
    // to the last. It is what makes `notes april` reach a file whose path says
    // them in that order with a year in between.
    expect(matching(OFFERED, "april notes")).toStrictEqual([
      "Notes/2026/april.org",
    ]);
  });

  it("keeps the order the host answered in", () => {
    // The host sorts, so this does not: a second rule about order is a second
    // chance for the list to jump around under a keystroke that only narrowed
    // it.
    expect(matching(OFFERED, "o")).toStrictEqual(OFFERED);
  });

  it("offers nothing when nothing matches", () => {
    // An empty list rather than the whole list: a query that matches no file
    // is still a query, and answering it with every file would bury the fact
    // that it matched none.
    expect(matching(OFFERED, "nothing here")).toStrictEqual([]);
  });
});
