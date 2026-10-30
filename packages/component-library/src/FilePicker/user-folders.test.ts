import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { Stat, SystemError } from "@domicile-desktop/sdk/system";
import { FileType, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { UserFolderFiles } from "./user-folders";
import { distinct, namedIn, UserFolder, userFoldersIn } from "./user-folders";

const HOME = "/home/someone";

const MISSING: SystemError = {
  kind: SystemErrorKind.NotFound,
  message: "No such file or directory",
};

/**
 * Files holding `dirs` as `user-dirs.dirs`, with `directories` present and
 * each path in `links` leading to another.
 */
const filesWith = (
  dirs: string | undefined,
  directories: readonly string[],
  links: ReadonlyMap<string, string> = new Map(),
): UserFolderFiles => ({
  readText: (path) =>
    Promise.resolve(
      path === `${HOME}/.config/user-dirs.dirs` && dirs !== undefined
        ? Ok<string, SystemError>(dirs)
        : Err<string, SystemError>(MISSING),
    ),
  stat: (path) =>
    Promise.resolve(
      directories.includes(links.get(path) ?? path)
        ? Ok<Stat, SystemError>({
            fileType: FileType.Directory,
            modifiedMs: undefined,
            realPath: links.get(path) ?? path,
            size: 4096,
          })
        : Err<Stat, SystemError>(MISSING),
    ),
});

describe("namedIn", () => {
  it("reads each folder from `user-dirs.dirs`, expanding `$HOME`", () => {
    const named = namedIn(
      '# written by xdg-user-dirs-update\nXDG_DOWNLOAD_DIR="$HOME/Incoming"\nXDG_MUSIC_DIR="/data/music/"\n',
      HOME,
    );

    expect(named).toContainEqual({
      folder: UserFolder.Downloads,
      path: `${HOME}/Incoming`,
    });
    expect(named).toContainEqual({
      folder: UserFolder.Music,
      path: "/data/music",
    });
  });

  it("falls back to the usual names for folders it does not set", () => {
    expect(namedIn(undefined, HOME)).toContainEqual({
      folder: UserFolder.Templates,
      path: `${HOME}/Templates`,
    });
  });
});

describe("distinct", () => {
  it("keeps one entry per directory and drops the home", () => {
    const named = namedIn(
      'XDG_DESKTOP_DIR="$HOME/"\nXDG_PUBLICSHARE_DIR="$HOME"\nXDG_TEMPLATES_DIR="$HOME/Documents"\n',
      HOME,
    );

    const folders = distinct(named, HOME).map(({ folder }) => folder);

    expect(folders).not.toContain(UserFolder.Desktop);
    expect(folders).not.toContain(UserFolder.Public);
    expect(folders).not.toContain(UserFolder.Templates);
    expect(folders).toContain(UserFolder.Documents);
  });
});

describe("userFoldersIn", () => {
  it("lists only the folders that exist, in file manager order", async () => {
    const places = await userFoldersIn(
      filesWith(undefined, [`${HOME}/Downloads`, `${HOME}/Desktop`]),
      HOME,
    );

    expect(places).toStrictEqual([
      { folder: UserFolder.Desktop, path: `${HOME}/Desktop` },
      { folder: UserFolder.Downloads, path: `${HOME}/Downloads` },
    ]);
  });

  it("lists a directory once when a link leads a second folder to it", async () => {
    const places = await userFoldersIn(
      filesWith(
        'XDG_MUSIC_DIR="/data/music"\nXDG_VIDEOS_DIR="$HOME/Videos"\n',
        [`${HOME}`, "/data/music"],
        new Map([[`${HOME}/Videos`, "/data/music"]]),
      ),
      HOME,
    );

    expect(places).toStrictEqual([
      { folder: UserFolder.Music, path: "/data/music" },
    ]);
  });

  it("leaves out a folder that leads back to the home", async () => {
    const places = await userFoldersIn(
      filesWith(
        undefined,
        [HOME, "/real/home"],
        new Map([
          [HOME, "/real/home"],
          [`${HOME}/Desktop`, "/real/home"],
        ]),
      ),
      HOME,
    );

    expect(places).toStrictEqual([]);
  });
});
