/** What a file holds, for the icon beside it. */
export enum FileKind {
  Archive,
  Audio,
  Image,
  Other,
  Pdf,
  Video,
}

const KINDS: ReadonlyMap<string, FileKind> = new Map([
  ["7z", FileKind.Archive],
  ["bz2", FileKind.Archive],
  ["gz", FileKind.Archive],
  ["rar", FileKind.Archive],
  ["tar", FileKind.Archive],
  ["tgz", FileKind.Archive],
  ["xz", FileKind.Archive],
  ["zip", FileKind.Archive],
  ["zst", FileKind.Archive],
  ["flac", FileKind.Audio],
  ["m4a", FileKind.Audio],
  ["mp3", FileKind.Audio],
  ["ogg", FileKind.Audio],
  ["opus", FileKind.Audio],
  ["wav", FileKind.Audio],
  ["avif", FileKind.Image],
  ["gif", FileKind.Image],
  ["jpeg", FileKind.Image],
  ["jpg", FileKind.Image],
  ["png", FileKind.Image],
  ["svg", FileKind.Image],
  ["webp", FileKind.Image],
  ["pdf", FileKind.Pdf],
  ["mkv", FileKind.Video],
  ["mov", FileKind.Video],
  ["mp4", FileKind.Video],
  ["webm", FileKind.Video],
]);

/** The kind of the file at `path`, from its extension. */
export const fileKind = (path: string): FileKind => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1
    ? FileKind.Other
    : (KINDS.get(name.slice(dot + 1).toLowerCase()) ?? FileKind.Other);
};
