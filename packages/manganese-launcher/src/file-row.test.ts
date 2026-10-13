import { describe, expect, it } from "bun:test";
import { fileRow } from "./file-row";

describe("fileRow", () => {
  it("reads a path as the name and the directories that disambiguate it", () => {
    expect(fileRow("Notes/2026/april.org")).toStrictEqual({
      directory: "Notes/2026",
      isDirectory: false,
      name: "april.org",
      path: "Notes/2026/april.org",
    });
  });

  it("gives a path at the top of home no directory to show", () => {
    expect(fileRow("todo.txt")).toStrictEqual({
      directory: undefined,
      isDirectory: false,
      name: "todo.txt",
      path: "todo.txt",
    });
  });

  it("reads the host's slash as a directory, and leaves it off the path", () => {
    // The slash is how the host says it, not part of what is opened: a row
    // for `Notes/2026/` edits `Notes/2026`, which is the path the host knows.
    expect(fileRow("Notes/2026/")).toStrictEqual({
      directory: "Notes",
      isDirectory: true,
      name: "2026",
      path: "Notes/2026",
    });
  });
});
