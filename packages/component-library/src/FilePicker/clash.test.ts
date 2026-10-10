import { describe, expect, it } from "bun:test";
import { Clash, clashOf } from "./clash";

describe("clashOf", () => {
  const entries = ["Pictures/", "notes.txt"];

  it("finds a file by the name", () => {
    expect(clashOf(entries, "notes.txt")).toBe(Clash.File);
  });

  it("finds a folder by the name", () => {
    expect(clashOf(entries, "Pictures")).toBe(Clash.Folder);
  });

  // Names are case-sensitive on Linux.
  it("finds nothing by another name, or the same name in another case", () => {
    expect(clashOf(entries, "Notes.txt")).toBe(Clash.None);
  });
});
