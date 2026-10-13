// Files the preview loads by URL instead of asking the host to read them,
// chosen by extension. For audio, the engine plays the file and the host reads
// its tags.
//
// The engine serves home at `domicile://home/`, to the shell only and without
// dotfiles. See `kDomicileHomeHost` in the engine.

/** The element type a file is previewed in. */
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

/** The media kind of `path`, or `undefined` if the host previews it. */
export const mediaOf = (path: string): MediaKind | undefined => {
  const dot = path.lastIndexOf(".");
  return dot === -1
    ? undefined
    : BY_EXTENSION[path.slice(dot + 1).toLowerCase()];
};

/** The engine URL for `path`, relative to home. */
export const homeUrl = (path: string): string =>
  `domicile://home/${path.split("/").map(encodeURIComponent).join("/")}`;
