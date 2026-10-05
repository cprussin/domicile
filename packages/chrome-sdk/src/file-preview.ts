// What a path holds, as a launcher's preview draws it.
//
// A shell turns what `previewFile()` resolves with into one, and switches on
// it. The wire's words are the engine's `kind` strings; this is the memory
// form, and `filePreviewKindSchema` is the one place the two meet.

import { z } from "zod";

/** Which of the five things a preview can be. */
export enum FilePreviewKind {
  Text,
  Directory,
  Audio,
  Binary,
  Unreadable,
}

/** What a song says of itself. A tag it does not say is `undefined`. */
export type AudioTags = {
  album: string | undefined;
  artist: string | undefined;
  /** The picture it carries of itself, as a `data:` URL. */
  cover: string | undefined;
  /** How long it plays, in seconds. */
  duration: number;
  title: string | undefined;
};

export const FilePreview = {
  /** A file that plays as sound, by what it says of itself. */
  Audio: (tags: AudioTags) => ({ kind: FilePreviewKind.Audio as const, tags }),
  /** A file that is not text, and so has nothing a preview can draw. */
  Binary: () => ({ kind: FilePreviewKind.Binary as const }),
  /** The front of what a directory holds, a directory ending in `/`. */
  Directory: (entries: readonly string[]) => ({
    entries,
    kind: FilePreviewKind.Directory as const,
  }),
  /** The front of a file that reads as text. */
  Text: (text: string) => ({ kind: FilePreviewKind.Text as const, text }),
  /** Not in the home's index, or not readable: nothing to show. */
  Unreadable: () => ({ kind: FilePreviewKind.Unreadable as const }),
};

export type FilePreview = ReturnType<
  (typeof FilePreview)[keyof typeof FilePreview]
>;

/** The engine's `kind` word, read as the kind it names. */
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
