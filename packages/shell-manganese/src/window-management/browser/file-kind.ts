// What a file is, as far as its name says: the picker's glyph, its tile's
// color and the Kind column all come from here.

export enum FileKind {
  Archive,
  Audio,
  Code,
  Document,
  Image,
  Pdf,
  Video,
  Other,
}

/** Extensions by the kind they say a file is, lower case and dotless. */
const KINDS: ReadonlyMap<string, FileKind> = new Map([
  ...["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip", "zst"].map(
    (extension) => [extension, FileKind.Archive] as const,
  ),
  ...["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"].map(
    (extension) => [extension, FileKind.Audio] as const,
  ),
  ...[
    "c",
    "cc",
    "css",
    "go",
    "h",
    "html",
    "js",
    "json",
    "nix",
    "py",
    "rs",
    "sh",
    "toml",
    "ts",
    "tsx",
    "yaml",
    "yml",
  ].map((extension) => [extension, FileKind.Code] as const),
  ...["csv", "doc", "docx", "md", "odt", "org", "rtf", "txt"].map(
    (extension) => [extension, FileKind.Document] as const,
  ),
  ...["avif", "bmp", "gif", "heic", "jpeg", "jpg", "png", "svg", "webp"].map(
    (extension) => [extension, FileKind.Image] as const,
  ),
  ["pdf", FileKind.Pdf] as const,
  ...["avi", "m4v", "mkv", "mov", "mp4", "webm"].map(
    (extension) => [extension, FileKind.Video] as const,
  ),
]);

export const fileKindOf = (name: string): FileKind => {
  const extension = extensionOf(name);
  // Most files are none of the kinds above: that is what `Other` is.
  return (
    (extension === undefined ? undefined : KINDS.get(extension)) ??
    FileKind.Other
  );
};

/** What the Kind column says: the extension, and what it makes the file. */
export const kindLabel = (name: string): string => {
  const extension = extensionOf(name);
  return extension === undefined
    ? "File"
    : `${extension.toUpperCase()} ${nounOf(fileKindOf(name))}`;
};

/**
 * The lower-cased text after a name's last dot, or `undefined` when there is
 * none — a leading dot starts a name, it does not end one.
 */
const extensionOf = (name: string): string | undefined => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
};

const nounOf = (kind: FileKind): string => {
  switch (kind) {
    case FileKind.Archive: {
      return "archive";
    }
    case FileKind.Audio: {
      return "audio";
    }
    case FileKind.Code: {
      return "source";
    }
    case FileKind.Document:
    case FileKind.Pdf: {
      return "document";
    }
    case FileKind.Image: {
      return "image";
    }
    case FileKind.Video: {
      return "video";
    }
    case FileKind.Other: {
      return "file";
    }
  }
};
