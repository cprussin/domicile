// What a folder preview draws an entry as. A directory is the host's to say,
// with a trailing `/`; everything else is read off the name.

import { languageOf } from "./highlight";
import { MediaKind, mediaOf } from "./media";

export enum EntryKind {
  Folder,
  Image,
  Video,
  Audio,
  Pdf,
  Code,
  Other,
}

export const entryKindOf = (entry: string): EntryKind => {
  if (entry.endsWith("/")) {
    return EntryKind.Folder;
  } else {
    const media = mediaOf(entry);
    return media === undefined ? codeOrOther(entry) : BY_MEDIA[media];
  }
};

const BY_MEDIA: Readonly<Record<MediaKind, EntryKind>> = {
  [MediaKind.Image]: EntryKind.Image,
  [MediaKind.Video]: EntryKind.Video,
  [MediaKind.Audio]: EntryKind.Audio,
  [MediaKind.Pdf]: EntryKind.Pdf,
};

const codeOrOther = (entry: string): EntryKind =>
  languageOf(entry) === undefined ? EntryKind.Other : EntryKind.Code;
