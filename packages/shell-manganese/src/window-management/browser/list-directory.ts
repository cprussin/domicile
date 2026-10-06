// A directory's entries for the file picker, read through the system calls.

import type { DirEntry, System } from "@domicile-desktop/sdk/system";
import { FileType } from "@domicile-desktop/sdk/system";

/**
 * The entries of the directory at absolute `path`, as `FileRequest.list`
 * wants them: subdirectory names, and links to directories, end in `/`.
 * Rejects with a `NotReadableError` `DOMException` if the directory cannot be
 * read.
 */
export const listDirectory = async (
  system: System,
  path: string,
): Promise<string[]> =>
  (await system.readDir(path)).match({
    Err: (error) => {
      throw new DOMException(error.message, "NotReadableError");
    },
    Ok: (entries) =>
      Promise.all(entries.map((entry) => shownName(system, path, entry))),
  });

const shownName = async (
  system: System,
  directory: string,
  { fileType, name }: DirEntry,
): Promise<string> =>
  (await isDirectory(system, directory, name, fileType)) ? `${name}/` : name;

/**
 * Whether the entry is a directory, following a link. A dangling link counts
 * as a file: the picker lists it, and picking it fails where it is read.
 */
const isDirectory = async (
  system: System,
  directory: string,
  name: string,
  fileType: FileType,
): Promise<boolean> => {
  switch (fileType) {
    case FileType.Directory: {
      return true;
    }
    case FileType.Symlink: {
      const target = await system.stat(childOf(directory, name));
      return target.match({
        Err: () => false,
        Ok: (stat) => stat.fileType === FileType.Directory,
      });
    }
    case FileType.File:
    case FileType.Other: {
      return false;
    }
  }
};

const childOf = (directory: string, name: string): string =>
  directory === "/" ? `/${name}` : `${directory}/${name}`;
