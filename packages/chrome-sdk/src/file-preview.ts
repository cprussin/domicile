// A preview of a path's contents, as a launcher draws it.
//
// `filePreviewKindSchema` maps the `kind` of `previewFile`'s answer to the
// enum.

import { z } from "zod";

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
  /** Length in seconds. */
  duration: number;
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
  /** Not in the home's index, or not readable. */
  Unreadable: () => ({ kind: FilePreviewKind.Unreadable as const }),
};

export type FilePreview = ReturnType<
  (typeof FilePreview)[keyof typeof FilePreview]
>;

/** Parses the engine's `kind` string into a {@link FilePreviewKind}. */
export const filePreviewKindSchema = z
  .enum(["text", "directory", "audio", "binary", "unreadable"])
  .transform((kind) => {
    switch (kind) {
      case "text": {
        return FilePreviewKind.Text;
      }
      case "directory": {
        return FilePreviewKind.Directory;
      }
      case "audio": {
        return FilePreviewKind.Audio;
      }
      case "binary": {
        return FilePreviewKind.Binary;
      }
      case "unreadable": {
        return FilePreviewKind.Unreadable;
      }
    }
  });
