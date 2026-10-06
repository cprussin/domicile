import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";
import type {
  DirEntry,
  System,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";

import { listDirectory } from "./list-directory";

describe("listDirectory", () => {
  it("marks directories, and links to them, with a trailing slash", async () => {
    const system = fakeSystem({
      "/home/someone/broken": { linksTo: "/nowhere" },
      "/home/someone/notes.txt": "notes",
      "/home/someone/photos/cat.png": "png",
      "/home/someone/pictures": { linksTo: "/home/someone/photos" },
      "/home/someone/today.txt": { linksTo: "/home/someone/notes.txt" },
    });

    expect(
      (await listDirectory(system, "/home/someone")).toSorted(),
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
    const tree = fakeSystem({
      "/bin": { linksTo: "/usr/bin" },
      "/usr/bin/sh": "sh",
    });
    // The fake cannot list the root itself.
    const system: System = {
      ...tree,
      readDir: () =>
        Promise.resolve(
          Ok<DirEntry[], SystemError>([
            { fileType: FileType.Symlink, name: "bin" },
          ]),
        ),
    };

    expect(await listDirectory(system, "/")).toStrictEqual(["bin/"]);
  });

  it("rejects as unreadable when the directory cannot be read", async () => {
    const system = fakeSystem({
      "/root": { fails: SystemErrorKind.PermissionDenied },
    });

    await expect(listDirectory(system, "/root")).rejects.toMatchObject({
      name: "NotReadableError",
    });
  });
});
