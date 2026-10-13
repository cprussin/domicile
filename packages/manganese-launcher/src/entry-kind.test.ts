import { describe, expect, it } from "bun:test";

import { EntryKind, entryKindOf } from "./entry-kind";

describe("entryKindOf", () => {
  it("reads a folder's entry as the kind of thing it is", () => {
    expect(entryKindOf("2026/")).toBe(EntryKind.Folder);
    expect(entryKindOf("cat.png")).toBe(EntryKind.Image);
    expect(entryKindOf("clip.mp4")).toBe(EntryKind.Video);
    expect(entryKindOf("song.flac")).toBe(EntryKind.Audio);
    expect(entryKindOf("paper.pdf")).toBe(EntryKind.Pdf);
    expect(entryKindOf("main.rs")).toBe(EntryKind.Code);
    expect(entryKindOf("todo.txt")).toBe(EntryKind.Other);
  });
});
