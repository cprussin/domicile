import { describe, expect, it } from "bun:test";

import { FileKind, fileKind } from "./file-kind";

describe(fileKind, () => {
  it("reads a file's kind from its extension, in any case", () => {
    expect(fileKind("/home/me/Downloads/report.PDF")).toBe(FileKind.Pdf);
    expect(fileKind("/home/me/Downloads/beach.jpg")).toBe(FileKind.Image);
    expect(fileKind("/home/me/Downloads/photos.tar.gz")).toBe(FileKind.Archive);
    expect(fileKind("/home/me/Downloads/clip.webm")).toBe(FileKind.Video);
    expect(fileKind("/home/me/Downloads/song.flac")).toBe(FileKind.Audio);
  });

  it("calls anything else a plain file", () => {
    expect(fileKind("/home/me/Downloads/notes.txt")).toBe(FileKind.Other);
    expect(fileKind("/home/me/Downloads/Makefile")).toBe(FileKind.Other);
  });
});
