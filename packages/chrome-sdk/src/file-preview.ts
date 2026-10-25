// A preview of a path's contents, as a launcher draws it, read through the
// shell's file calls.

import type { AudioContainer } from "./audio-tags/audio-tags";
import { audioContainer, audioTags } from "./audio-tags/audio-tags";
import type { Files } from "./desktop/files";
import { FileType } from "./system";

/** Bytes of a file read for its preview. */
const PREVIEW_BYTES = 8 * 1024;

/** Directory entries in a preview. */
const PREVIEW_ENTRIES = 200;

/** The kinds of file preview. */
export enum FilePreviewKind {
  Text,
  Directory,
  Audio,
  Binary,
  Unreadable,
}

/** An audio file's tags. A missing tag is `undefined`. */
export type AudioTags = {
  album: string | undefined;
  artist: string | undefined;
  /** Embedded cover art, as a `data:` URL. */
  cover: string | undefined;
  title: string | undefined;
};

export const FilePreview = {
  /** An audio file and its tags. */
  Audio: (tags: AudioTags) => ({ kind: FilePreviewKind.Audio as const, tags }),
  /** A non-text file with nothing to preview. */
  Binary: () => ({ kind: FilePreviewKind.Binary as const }),
  /** The first entries of a directory. Subdirectories end in `/`. */
  Directory: (entries: readonly string[]) => ({
    entries,
    kind: FilePreviewKind.Directory as const,
  }),
  /** The start of a text file. */
  Text: (text: string) => ({ kind: FilePreviewKind.Text as const, text }),
  /** Missing, or not readable. */
  Unreadable: () => ({ kind: FilePreviewKind.Unreadable as const }),
};

export type FilePreview = ReturnType<
  (typeof FilePreview)[keyof typeof FilePreview]
>;

/** The file calls a preview makes. */
export type PreviewDesktop = {
  readonly files: Pick<Files, "read" | "readDir" | "stat">;
};

/**
 * Preview `path`: a directory's entries, a song's tags, or the start of a
 * file as text. A relative path starts at the home. Songs are told by their
 * contents, not their names.
 */
export const previewFile = async (
  domicile: PreviewDesktop,
  path: string,
): Promise<FilePreview> =>
  (await domicile.files.stat(path)).match({
    Err: () => Promise.resolve(FilePreview.Unreadable()),
    Ok: ({ fileType }) =>
      fileType === FileType.Directory
        ? listed(domicile, path)
        : contents(domicile, path),
  });

/** A directory's entry names, sorted, with directories ending in `/`. */
const listed = async (
  domicile: PreviewDesktop,
  path: string,
): Promise<FilePreview> =>
  (await domicile.files.readDir(path)).match<FilePreview>({
    Err: FilePreview.Unreadable,
    Ok: (entries) =>
      FilePreview.Directory(
        entries
          .map(({ fileType, name }) =>
            fileType === FileType.Directory ? `${name}/` : name,
          )
          .toSorted()
          .slice(0, PREVIEW_ENTRIES),
      ),
  });

const contents = async (
  domicile: PreviewDesktop,
  path: string,
): Promise<FilePreview> =>
  (await domicile.files.read(path, { length: PREVIEW_BYTES })).match({
    Err: () => Promise.resolve(FilePreview.Unreadable()),
    Ok: (head) => {
      const container = audioContainer(head);
      return container === undefined
        ? Promise.resolve(textOf(head))
        : song(domicile, path, container);
    },
  });

const song = async (
  domicile: PreviewDesktop,
  path: string,
  container: AudioContainer,
): Promise<FilePreview> =>
  (
    await audioTags(container, (offset, length) =>
      domicile.files.read(path, { length, offset }),
    )
  ).match<FilePreview>({
    Err: FilePreview.Unreadable,
    Ok: FilePreview.Audio,
  });

/**
 * The start of a file, as text if it is text. A NUL or invalid UTF-8 means
 * binary. A character cut off by the limit is dropped: a streaming decoder
 * holds it back rather than call it invalid.
 */
const textOf = (bytes: Uint8Array): FilePreview => {
  try {
    return bytes.includes(0)
      ? FilePreview.Binary()
      : FilePreview.Text(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
            stream: true,
          }),
        );
  } catch (error) {
    // A fatal decoder throws a TypeError for invalid UTF-8.
    if (error instanceof TypeError) {
      return FilePreview.Binary();
    } else {
      throw error;
    }
  }
};
