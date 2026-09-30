import { describe, expect, it } from "bun:test";

import { fileRow } from "../../launcher/file-row";
import { ChooserMode } from "./file-request";
import { HOME, pickable, pickableIn } from "./pickable";

/** What the host found, in its own vocabulary: a directory ends in `/`. */
const FOUND = [
  "Documents/",
  "Documents/report.PDF",
  "Pictures/",
  "Pictures/cat.png",
  "notes.txt",
];

const paths = (rows: readonly { path: string }[]): readonly string[] =>
  rows.map(({ path }) => path);

describe("pickable", () => {
  it("offers files and no directories to open", () => {
    for (const mode of [ChooserMode.Open, ChooserMode.OpenMultiple]) {
      expect(
        paths(pickable({ accept: [], found: FOUND, mode, query: "" })),
      ).toStrictEqual([
        "Documents/report.PDF",
        "Pictures/cat.png",
        "notes.txt",
      ]);
    }
  });

  // The browser has already turned `image/*` into extensions, lower case.
  it("offers only the files the page will take, whatever their case", () => {
    expect(
      paths(
        pickable({
          accept: ["pdf", "png"],
          found: FOUND,
          mode: ChooserMode.Open,
          query: "",
        }),
      ),
    ).toStrictEqual(["Documents/report.PDF", "Pictures/cat.png"]);
  });

  // An extension of two parts is still the end of the name, and a name that
  // merely ends in the same letters is not that kind of file.
  it("matches an extension at the end of the name, after its dot", () => {
    expect(
      paths(
        pickable({
          accept: ["tar.gz"],
          found: ["backup.tar.gz", "backup.gz", "notargz"],
          mode: ChooserMode.Open,
          query: "",
        }),
      ),
    ).toStrictEqual(["backup.tar.gz"]);
  });

  it("offers directories and no files for a folder", () => {
    expect(
      pickable({
        accept: [],
        found: FOUND,
        mode: ChooserMode.OpenFolder,
        query: "",
      }),
    ).toStrictEqual([fileRow("Documents/"), fileRow("Pictures/")]);
  });

  // A save goes somewhere, and home is the first somewhere — but it is only
  // the first while nothing has been typed: a query is the user looking for
  // somewhere else, and Enter on it should not land in home.
  it("offers home and then the directories to save in", () => {
    expect(
      pickable({ accept: [], found: FOUND, mode: ChooserMode.Save, query: "" }),
    ).toStrictEqual([HOME, fileRow("Documents/"), fileRow("Pictures/")]);
    expect(
      pickable({
        accept: [],
        found: ["Pictures/"],
        mode: ChooserMode.Save,
        query: "pic",
      }),
    ).toStrictEqual([fileRow("Pictures/")]);
  });

  // Home is the empty path, which is what a save into it joins onto.
  it("names home as the empty path", () => {
    expect(HOME.path).toBe("");
    expect(HOME.isDirectory).toBe(true);
  });
});

/** A directory the engine listed, in its own vocabulary: a directory ends in `/`. */
const LISTED = ["photo.PNG", "zines/", "Albums/", "notes.txt", ".cache/"];

describe("pickableIn", () => {
  const listed = (
    mode: ChooserMode,
    {
      accept = [],
      directory = "/mnt/usb",
      filter = "",
    }: { accept?: string[]; directory?: string; filter?: string } = {},
  ) =>
    pickableIn({
      accept,
      browsed: { directory, filter, typed: `${directory}/` },
      entries: LISTED,
      mode,
    });

  // A directory is where a file might be, so opening one walks into it.
  it("offers directories first and then the files the page will take", () => {
    expect(paths(listed(ChooserMode.Open, { accept: ["png"] }))).toStrictEqual([
      "/mnt/usb/Albums",
      "/mnt/usb/zines",
      "/mnt/usb/photo.PNG",
    ]);
  });

  it("names each row alone, the directory being the one typed", () => {
    expect(listed(ChooserMode.Open)[0]).toStrictEqual({
      directory: undefined,
      isDirectory: true,
      name: "Albums",
      path: "/mnt/usb/Albums",
    });
  });

  it("narrows to the names holding what is typed after the last slash", () => {
    expect(paths(listed(ChooserMode.Open, { filter: "OT" }))).toStrictEqual([
      "/mnt/usb/notes.txt",
      "/mnt/usb/photo.PNG",
    ]);
  });

  // A shell's convention: a dot is typed to see what starts with one.
  it("hides what starts with a dot until a dot is typed", () => {
    expect(
      paths(listed(ChooserMode.OpenFolder, { filter: "." })),
    ).toStrictEqual(["/mnt/usb/.cache"]);
  });

  // The directory being listed is an answer too, and the first one while
  // nothing narrows the listing.
  it("offers the directory itself first to choose or save in", () => {
    for (const mode of [ChooserMode.OpenFolder, ChooserMode.Save]) {
      expect(paths(listed(mode))).toStrictEqual([
        "/mnt/usb",
        "/mnt/usb/Albums",
        "/mnt/usb/zines",
      ]);
      expect(paths(listed(mode, { filter: "z" }))).toStrictEqual([
        "/mnt/usb/zines",
      ]);
    }
    expect(listed(ChooserMode.Save, { directory: "" })[0]).toBe(HOME);
  });
});
