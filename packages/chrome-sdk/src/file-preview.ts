// What a path holds, as a launcher's preview draws it.
//
// Its own module because both halves of the SDK read it: `host-message.ts`
// turns the engine's `filepreview` event into one, and a shell switches on it.
// The wire's words are the engine's `kind` strings; this is the memory form,
// and `filePreviewKindSchema` is the one place the two meet.

import { z } from "zod";

/** Which of the four things a preview can be. */
export enum FilePreviewKind {
  Text,
  Directory,
  Binary,
  Unreadable,
}

export const FilePreview = {
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
  .enum(["text", "directory", "binary", "unreadable"])
  .transform((kind) => {
    switch (kind) {
      case "text": {
        return FilePreviewKind.Text;
      }
      case "directory": {
        return FilePreviewKind.Directory;
      }
      case "binary": {
        return FilePreviewKind.Binary;
      }
      case "unreadable": {
        return FilePreviewKind.Unreadable;
      }
    }
  });
