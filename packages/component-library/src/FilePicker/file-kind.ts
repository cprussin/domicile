// A file's kind from its name, for the picker's icon, tile color and Kind
// column.

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

/** Extensions per kind, lowercase and without the dot. */
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
  return (
    (extension === undefined ? undefined : KINDS.get(extension)) ??
    FileKind.Other
  );
};

/** The Kind column text: the extension and its kind. */
export const kindLabel = (name: string): string => {
  const extension = extensionOf(name);
  return extension === undefined
    ? "File"
    : `${extension.toUpperCase()} ${nounOf(fileKindOf(name))}`;
};

/**
 * The lowercase extension after the last dot, if any. A leading dot (a
 * dotfile) is not an extension.
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
