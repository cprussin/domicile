import { describe, expect, it } from "bun:test";
import { directoriesIn, fileRow } from "./file-row";

describe("directoriesIn", () => {
  it("names every path another offered path is inside of", () => {
    // Including the ones nothing offered on their own line: a home walked two
    // levels deep offers `Notes/2026/april.org` whether or not it offered
    // `Notes/2026`, and both of the names above it are still directories.
    expect([
      ...directoriesIn(["Notes/2026/april.org", "Notes/today.org", "todo.txt"]),
    ]).toStrictEqual(["Notes", "Notes/2026"]);
  });
});

describe("fileRow", () => {
  it("reads a path as the name and the directories that disambiguate it", () => {
    expect(fileRow("Notes/2026/april.org", new Set())).toStrictEqual({
      directory: "Notes/2026",
      isDirectory: false,
      name: "april.org",
    });
  });

  it("gives a path at the top of home no directory to show", () => {
    expect(fileRow("todo.txt", new Set())).toStrictEqual({
      directory: undefined,
      isDirectory: false,
      name: "todo.txt",
    });
  });

  it("says so when the path is one of the directories", () => {
    expect(fileRow("Notes", new Set(["Notes"]))).toStrictEqual({
      directory: undefined,
      isDirectory: true,
      name: "Notes",
    });
  });
});
