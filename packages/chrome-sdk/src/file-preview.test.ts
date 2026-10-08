import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import type { PreviewSystem } from "./file-preview";
import { FilePreview, previewFile } from "./file-preview";
import type { DirEntry, SystemError } from "./system";
import { FileType, SystemErrorKind } from "./system";

/** A system holding `files`, and directories of `entries`, by path. */
const holding = (
  files: Readonly<Record<string, Uint8Array | string>>,
  directories: Readonly<Record<string, readonly DirEntry[]>> = {},
): PreviewSystem => {
  const missing = (path: string): Result<never, SystemError> =>
    Err({ kind: SystemErrorKind.NotFound, message: path });
  const bytesAt = (path: string) => {
    const file = files[path];
    return typeof file === "string" ? new TextEncoder().encode(file) : file;
  };
  return {
    readDir: (path) => {
      const entries = directories[path];
      return Promise.resolve(
        entries === undefined ? missing(path) : Ok([...entries]),
      );
    },
    readFile: (path, range) => {
      const bytes = bytesAt(path);
      const offset = range?.offset ?? 0;
      return Promise.resolve(
        bytes === undefined
          ? missing(path)
          : Ok(
              bytes.subarray(
                offset,
                range?.length === undefined ? undefined : offset + range.length,
              ),
            ),
      );
    },
    stat: (path) => {
      const bytes = bytesAt(path);
      const directory = directories[path] !== undefined;
      return Promise.resolve(
        bytes === undefined && !directory
          ? missing(path)
          : Ok({
              fileType: directory ? FileType.Directory : FileType.File,
              modifiedMs: undefined,
              size: bytes?.length ?? 0,
            }),
      );
    },
  };
};

const file = (name: string): DirEntry => ({ fileType: FileType.File, name });

describe("previewFile", () => {
  describe("text", () => {
    it("shows the start of a text file", async () => {
      const long = "a".repeat(10_000);

      expect(
        await previewFile(holding({ "notes.txt": long }), "notes.txt"),
      ).toStrictEqual(FilePreview.Text("a".repeat(8 * 1024)));
    });

    it("drops a character the limit cuts in two", async () => {
      // "é" is two bytes; the second is past the limit.
      const cut = new Uint8Array([
        ...Array(8 * 1024 - 1).fill(0x61),
        0xc3,
        0xa9,
      ]);

      expect(
        await previewFile(holding({ "cut.txt": cut }), "cut.txt"),
      ).toStrictEqual(FilePreview.Text("a".repeat(8 * 1024 - 1)));
    });

    it("reads a NUL or invalid UTF-8 as binary", async () => {
      const system = holding({
        invalid: new Uint8Array([0x61, 0xc3, 0x28, 0x61]),
        nul: new Uint8Array([0x61, 0x00, 0x62]),
      });

      expect(await previewFile(system, "nul")).toStrictEqual(
        FilePreview.Binary(),
      );
      expect(await previewFile(system, "invalid")).toStrictEqual(
        FilePreview.Binary(),
      );
    });
  });

  describe("directories", () => {
    it("lists a directory's names, sorted, with directories ending in /", async () => {
      const system = holding(
        {},
        {
          Notes: [
            file("today.org"),
            { fileType: FileType.Directory, name: "2026" },
            { fileType: FileType.Symlink, name: "link" },
          ],
        },
      );

      expect(await previewFile(system, "Notes")).toStrictEqual(
        FilePreview.Directory(["2026/", "link", "today.org"]),
      );
    });

    it("lists the first 200 entries", async () => {
      const names = Array.from({ length: 250 }, (_, at) =>
        `${at}`.padStart(3, "0"),
      );
      const system = holding({}, { big: names.map(file) });

      expect(await previewFile(system, "big")).toStrictEqual(
        FilePreview.Directory(names.slice(0, 200)),
      );
    });
  });

  it("reads a path that cannot be read as unreadable", async () => {
    expect(await previewFile(holding({}), "gone.txt")).toStrictEqual(
      FilePreview.Unreadable(),
    );
  });

  describe("audio", () => {
    it("shows a song by its contents, whatever its name", async () => {
      // An ID3v2.4 tag holding only a title, "Song".
      const tagged = new Uint8Array([
        ...[0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 15],
        ...[0x54, 0x49, 0x54, 0x32, 0, 0, 0, 5, 0, 0, 3],
        ...new TextEncoder().encode("Song"),
        ...[0xff, 0xfb, 0x90, 0x00],
      ]);

      expect(
        await previewFile(holding({ "notes.txt": tagged }), "notes.txt"),
      ).toStrictEqual(
        FilePreview.Audio({
          album: undefined,
          artist: undefined,
          cover: undefined,
          title: "Song",
        }),
      );
    });

    it("reads a file named like a song that is not one as what it is", async () => {
      expect(
        await previewFile(
          holding({ "Music/notes.mp3": "in Music/notes.mp3\n" }),
          "Music/notes.mp3",
        ),
      ).toStrictEqual(FilePreview.Text("in Music/notes.mp3\n"));
    });
  });
});
