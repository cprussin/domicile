import { describe, expect, it } from "bun:test";

import { FileKind, fileKindOf, kindLabel } from "./file-kind";

describe("fileKindOf", () => {
  it("reads a file's kind off its extension, in any case", () => {
    expect(fileKindOf("cat.PNG")).toBe(FileKind.Image);
    expect(fileKindOf("report.pdf")).toBe(FileKind.Pdf);
    expect(fileKindOf("backup.tar.gz")).toBe(FileKind.Archive);
    expect(fileKindOf("main.rs")).toBe(FileKind.Code);
    expect(fileKindOf("song.flac")).toBe(FileKind.Audio);
    expect(fileKindOf("clip.mkv")).toBe(FileKind.Video);
    expect(fileKindOf("notes.org")).toBe(FileKind.Document);
  });

  // A dotfile's dot starts its name, not an extension.
  it("is other for no extension, or one it does not know", () => {
    expect(fileKindOf("Makefile")).toBe(FileKind.Other);
    expect(fileKindOf(".bashrc")).toBe(FileKind.Other);
    expect(fileKindOf("thing.xyz")).toBe(FileKind.Other);
  });
});

describe("kindLabel", () => {
  it("says what a file is the way a file manager does", () => {
    expect(kindLabel("cat.png")).toBe("PNG image");
    expect(kindLabel("report.pdf")).toBe("PDF document");
    expect(kindLabel("backup.tar.gz")).toBe("GZ archive");
    expect(kindLabel("main.rs")).toBe("RS source");
    expect(kindLabel("notes.org")).toBe("ORG document");
    expect(kindLabel("thing.xyz")).toBe("XYZ file");
    expect(kindLabel("Makefile")).toBe("File");
  });
});
