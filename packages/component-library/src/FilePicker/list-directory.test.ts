import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";
import type { DirEntry, SystemError } from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";
import { fakeDesktop } from "@domicile-desktop/system-apps/fake-desktop";

import type { ListedFiles } from "./list-directory";
import { listDirectory } from "./list-directory";

describe("listDirectory", () => {
  it("marks directories, and links to them, with a trailing slash", async () => {
    const system = fakeDesktop({
      "/home/someone/broken": { linksTo: "/nowhere" },
      "/home/someone/notes.txt": "notes",
      "/home/someone/photos/cat.png": "png",
      "/home/someone/pictures": { linksTo: "/home/someone/photos" },
      "/home/someone/today.txt": { linksTo: "/home/someone/notes.txt" },
    });

    expect(
      (await listDirectory(system.files, "/home/someone")).toSorted(),
    ).toStrictEqual([
      // A dangling link is listed; picking it fails where it is read.
      "broken",
      "notes.txt",
      "photos/",
      "pictures/",
      "today.txt",
    ]);
  });

  it("finds a link at the root under the root", async () => {
    const tree = fakeDesktop({
      "/bin": { linksTo: "/usr/bin" },
      "/usr/bin/sh": "sh",
    });
    // The fake cannot list the root itself.
    const files: ListedFiles = {
      ...tree.files,
      readDir: () =>
        Promise.resolve(
          Ok<DirEntry[], SystemError>([
            { fileType: FileType.Symlink, name: "bin" },
          ]),
        ),
    };

    expect(await listDirectory(files, "/")).toStrictEqual(["bin/"]);
  });

  it("rejects as unreadable when the directory cannot be read", async () => {
    const system = fakeDesktop({
      "/root": { fails: SystemErrorKind.PermissionDenied },
    });

    await expect(listDirectory(system.files, "/root")).rejects.toMatchObject({
      name: "NotReadableError",
    });
  });
});
