import { describe, expect, it } from "bun:test";

import { ChooserMode } from "./file-request";
import { RowKind, rowsIn } from "./rows";

/** A fake listing; directory names end in `/`. */
const ENTRIES = [
  "photo.PNG",
  "zines/",
  "Albums/",
  "notes.txt",
  ".cache/",
  "old-scratch/",
  "Scratch/",
];

const listed = (
  mode: ChooserMode,
  {
    accept = [],
    directory = "/mnt/usb",
    filter = "",
  }: { accept?: string[]; directory?: string; filter?: string } = {},
) =>
  rowsIn({ accept, directory, entries: ENTRIES, filter, mode }).map(
    ({ name }) => name,
  );

describe("rowsIn", () => {
  it("starts with the parent, then directories, then files", () => {
    expect(listed(ChooserMode.Open)).toStrictEqual([
      "..",
      "Albums",
      "old-scratch",
      "Scratch",
      "zines",
      "notes.txt",
      "photo.PNG",
    ]);
    expect(listed(ChooserMode.Open, { directory: "/" })[0]).toBe("Albums");
  });

  it("is each row's kind and full path", () => {
    expect(
      rowsIn({
        accept: [],
        directory: "/mnt/usb",
        entries: ["a/", "b.txt"],
        filter: "",
        mode: ChooserMode.Open,
      }),
    ).toStrictEqual([
      { kind: RowKind.Parent, name: "..", path: "/mnt" },
      { kind: RowKind.Directory, name: "a", path: "/mnt/usb/a" },
      { kind: RowKind.File, name: "b.txt", path: "/mnt/usb/b.txt" },
    ]);
  });

  // The browser has already expanded `image/*` into lowercase extensions.
  it("offers only the files the page will take, whatever their case", () => {
    expect(
      listed(ChooserMode.Open, { accept: ["png"] }).filter((name) =>
        name.includes("."),
      ),
    ).toStrictEqual(["..", "photo.PNG"]);
  });

  it("offers no files to choose a folder", () => {
    expect(listed(ChooserMode.OpenFolder)).not.toContain("notes.txt");
  });

  // A save shows existing files regardless of `accept`.
  it("offers every file to save over", () => {
    expect(listed(ChooserMode.Save, { accept: ["png"] })).toContain(
      "notes.txt",
    );
  });

  // So Enter after typing a name picks the one that starts with it.
  it("narrows to what holds the filter, what starts with it first", () => {
    expect(listed(ChooserMode.Open, { filter: "scr" })).toStrictEqual([
      "Scratch",
      "old-scratch",
    ]);
  });

  // As in a shell, dotfiles show only once a dot is typed.
  it("hides what starts with a dot until a dot is typed", () => {
    expect(listed(ChooserMode.Open)).not.toContain(".cache");
    expect(listed(ChooserMode.Open, { filter: "." })).toStrictEqual([
      "..",
      ".cache",
      "notes.txt",
      "photo.PNG",
    ]);
  });
});
