// Which files the launcher's preview draws itself rather than asking the host
// to read: the ones the engine can show from a URL, by extension.
//
// The engine serves them from `domicile://home/` — the user's home, to the
// shell's own document only, and never a dotfile. See `kDomicileHomeHost` in
// the engine.

/** What kind of element a file is previewed in. */
export enum MediaKind {
  Image,
  Video,
  Audio,
  Pdf,
}

const BY_EXTENSION: Readonly<Record<string, MediaKind>> = {
  avif: MediaKind.Image,
  bmp: MediaKind.Image,
  flac: MediaKind.Audio,
  gif: MediaKind.Image,
  ico: MediaKind.Image,
  jpeg: MediaKind.Image,
  jpg: MediaKind.Image,
  m4a: MediaKind.Audio,
  mkv: MediaKind.Video,
  mov: MediaKind.Video,
  mp3: MediaKind.Audio,
  mp4: MediaKind.Video,
  oga: MediaKind.Audio,
  ogg: MediaKind.Audio,
  ogv: MediaKind.Video,
  opus: MediaKind.Audio,
  pdf: MediaKind.Pdf,
  png: MediaKind.Image,
  svg: MediaKind.Image,
  wav: MediaKind.Audio,
  webm: MediaKind.Video,
  webp: MediaKind.Image,
};

/** What `path` is previewed as, or `undefined` for one the host reads. */
export const mediaOf = (path: string): MediaKind | undefined => {
  const dot = path.lastIndexOf(".");
  return dot === -1
    ? undefined
    : BY_EXTENSION[path.slice(dot + 1).toLowerCase()];
};

/** Where the engine serves `path`, relative to home, from. */
export const homeUrl = (path: string): string =>
  `domicile://home/${path.split("/").map(encodeURIComponent).join("/")}`;
