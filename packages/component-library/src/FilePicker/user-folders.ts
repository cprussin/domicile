// The user's standard folders, as `user-dirs.dirs` names them, for the file
// picker's sidebar.

import type { Files } from "@domicile-desktop/sdk/desktop/files";
import { FileType } from "@domicile-desktop/sdk/system";

import { pathIn } from "./path-in";

/** A folder `user-dirs.dirs` names. */
export enum UserFolder {
  Desktop,
  Documents,
  Downloads,
  Music,
  Pictures,
  Public,
  Templates,
  Videos,
}

/** A user folder and where it is. */
export type UserPlace = { folder: UserFolder; path: string };

/** The calls {@link userFoldersIn} makes. */
export type UserFolderFiles = Pick<Files, "readText" | "stat">;

/**
 * Each folder's `user-dirs.dirs` key and the name `xdg-user-dirs` gives it
 * when the file names none, in file manager order.
 */
const KEYS: readonly (readonly [UserFolder, string, string])[] = [
  [UserFolder.Desktop, "XDG_DESKTOP_DIR", "Desktop"],
  [UserFolder.Documents, "XDG_DOCUMENTS_DIR", "Documents"],
  [UserFolder.Downloads, "XDG_DOWNLOAD_DIR", "Downloads"],
  [UserFolder.Music, "XDG_MUSIC_DIR", "Music"],
  [UserFolder.Pictures, "XDG_PICTURES_DIR", "Pictures"],
  [UserFolder.Videos, "XDG_VIDEOS_DIR", "Videos"],
  [UserFolder.Templates, "XDG_TEMPLATES_DIR", "Templates"],
  [UserFolder.Public, "XDG_PUBLICSHARE_DIR", "Public"],
];

/**
 * The user folders that exist, each directory once, leaving out the home,
 * which the sidebar already has. `user-dirs.dirs` points a folder it has no
 * use for at the home, and may point two at one directory, by one path or
 * through a link.
 */
export const userFoldersIn = async (
  files: UserFolderFiles,
  home: string,
): Promise<readonly UserPlace[]> => {
  const dirs = (
    await files.readText(pathIn(home, ".config/user-dirs.dirs"))
  ).match({ Err: () => undefined, Ok: (text) => text });
  const [homeFound, ...found] = await Promise.all(
    [
      { folder: undefined, path: home },
      ...distinct(namedIn(dirs, home), home),
    ].map(async (place) => ({
      ...place,
      real: await realDirectory(files, place.path),
    })),
  );
  const seen = new Set([homeFound?.real]);
  return found.flatMap(({ folder, path, real }) => {
    if (real === undefined || seen.has(real) || folder === undefined) {
      return [];
    } else {
      seen.add(real);
      return [{ folder, path }];
    }
  });
};

/**
 * `path` with every link resolved, if it is a directory. A host too old to
 * resolve links gives back `path`.
 */
const realDirectory = async (
  files: UserFolderFiles,
  path: string,
): Promise<string | undefined> =>
  (await files.stat(path)).match({
    Err: () => undefined,
    Ok: (stat) =>
      stat.fileType === FileType.Directory
        ? (stat.realPath ?? normalized(path))
        : undefined,
  });

/** Where `dirs`, the contents of `user-dirs.dirs`, puts each folder. */
export const namedIn = (
  dirs: string | undefined,
  home: string,
): readonly UserPlace[] =>
  KEYS.map(([folder, key, fallback]) => ({
    folder,
    path: normalized(settingOf(dirs, key, home) ?? pathIn(home, fallback)),
  }));

/** `places` without the home or a directory listed before. */
export const distinct = (
  places: readonly UserPlace[],
  home: string,
): readonly UserPlace[] => {
  const seen = new Set([normalized(home)]);
  return places.filter(({ path }) => {
    const fresh = !seen.has(path);
    seen.add(path);
    return fresh;
  });
};

/** The path `key` is set to in `dirs`, with `$HOME` expanded. */
const settingOf = (
  dirs: string | undefined,
  key: string,
  home: string,
): string | undefined => {
  const line = dirs
    ?.split("\n")
    .map((each) => each.trim())
    .find((each) => each.startsWith(`${key}=`));
  if (line === undefined) {
    return undefined;
  } else {
    const value = line.slice(key.length + 1).replaceAll('"', "");
    return value.startsWith("$HOME") ? `${home}${value.slice(5)}` : value;
  }
};

/** `path` without repeated or trailing slashes, so equal folders compare equal. */
const normalized = (path: string): string =>
  path.replaceAll(/\/+/g, "/").replace(/(.)\/$/, "$1");
