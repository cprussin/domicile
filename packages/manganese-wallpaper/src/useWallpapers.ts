// Each theme's photographs with the config's folders listed, for the rotation.

import type { Files } from "@domicile-desktop/sdk/desktop/files";
import { FileType } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

import type { Wallpapers } from "./wallpapers";
import { isWebAddress } from "./wallpapers";

type FolderCalls = Pick<Files, "readDir" | "stat">;

/** The names a folder's images end in. */
const IMAGE = /\.(avif|gif|jpe?g|png|webp)$/i;

/**
 * `wallpapers` with each folder replaced by its images, sorted by name.
 * `undefined` until the folders are read. A path that cannot be read is
 * logged and left out.
 *
 * `files` and `wallpapers` must be stable: a new one lists again.
 */
export const useWallpapers = (
  files: FolderCalls,
  wallpapers: Wallpapers,
): Wallpapers | undefined => {
  const [listed, setListed] = useState<Wallpapers | undefined>(undefined);

  useEffect(() => {
    // Drops a listing that finishes after the config changed.
    let current = true;
    Promise.all([
      listPhotos(files, wallpapers.dark),
      listPhotos(files, wallpapers.light),
    ])
      .then(([dark, light]) => {
        if (current) {
          setListed({ dark, light });
        }
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: the rotation stays empty; say why
        console.error("cannot list the wallpapers", error);
      });
    return () => {
      current = false;
    };
  }, [files, wallpapers]);

  return listed;
};

/** One theme's `photos`, with each folder replaced by its images. */
const listPhotos = async (
  files: FolderCalls,
  photos: readonly string[],
): Promise<readonly string[]> =>
  (
    await Promise.all(
      photos.map((photo) =>
        isWebAddress(photo)
          ? Promise.resolve([photo])
          : listPath(files, homeRelative(photo)),
      ),
    )
  ).flat();

/** `path` without a leading `~/`, which the file calls read from the home. */
const homeRelative = (path: string): string =>
  path.startsWith("~/") ? path.slice(2) : path;

/** The image at `path`, or the images in the folder at `path`. */
const listPath = async (
  files: FolderCalls,
  path: string,
): Promise<readonly string[]> =>
  (await files.stat(path)).match({
    Err: (error) => {
      // biome-ignore lint/suspicious/noConsole: the photograph is left out; say why
      console.error(`cannot read the wallpaper ${path}`, error);
      return Promise.resolve([]);
    },
    Ok: ({ fileType }) =>
      fileType === FileType.Directory
        ? listFolder(files, path)
        : Promise.resolve([path]),
  });

/**
 * The images in the folder at `path`, by name. Links count, since a folder a
 * package manager writes holds links.
 */
const listFolder = async (
  files: FolderCalls,
  path: string,
): Promise<readonly string[]> =>
  (await files.readDir(path)).match({
    Err: (error) => {
      // biome-ignore lint/suspicious/noConsole: the folder is left out; say why
      console.error(`cannot list the wallpaper folder ${path}`, error);
      return [];
    },
    Ok: (entries) =>
      entries
        .filter(
          ({ fileType, name }) =>
            fileType !== FileType.Directory &&
            fileType !== FileType.Other &&
            IMAGE.test(name),
        )
        .map(({ name }) => name)
        .toSorted()
        .map((name) => `${path}/${name}`),
  });
