// A song's tags, read through the system calls. Containers are told by their
// first bytes, not by a file's name.

import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";

import type { AudioTags } from "../file-preview";
import type { SystemError } from "../system";
import { holds } from "./bytes";
import { flacTags } from "./flac";
import { id3v2Tags, isId3v2 } from "./id3v2";
import { mp4Tags } from "./mp4";
import { oggTags } from "./ogg";
import { audioTagsOf, NOTHING_SAID } from "./parsed-tags";
import type { ReadBytes } from "./read-bytes";
import { aiffTags, wavTags } from "./riff";

export enum AudioContainer {
  /** MP3, or anything else an ID3v2 tag starts. */
  Id3v2,
  /** MP3 with no ID3v2 tag. */
  Mpeg,
  Flac,
  Ogg,
  Mp4,
  Wav,
  Aiff,
}

/** Each container and how its first bytes look. */
const SIGNATURES: readonly [AudioContainer, (head: Uint8Array) => boolean][] = [
  [AudioContainer.Id3v2, isId3v2],
  // An MPEG audio frame: an 11-bit sync, then any bitrate but the invalid
  // one. Text cannot start this way: 0xff is not UTF-8.
  [
    AudioContainer.Mpeg,
    ([first, second, third]) =>
      first === 0xff &&
      second !== undefined &&
      third !== undefined &&
      (second & 0xe0) === 0xe0 &&
      third >> 4 !== 0x0f,
  ],
  // The first block is STREAMINFO, type 0.
  [
    AudioContainer.Flac,
    (head) =>
      holds(head, "fLaC") && head[4] !== undefined && (head[4] & 0x7f) === 0,
  ],
  // Version 0.
  [AudioContainer.Ogg, (head) => holds(head, "OggS") && head[4] === 0],
  [AudioContainer.Mp4, (head) => holds(head, "ftyp", 4)],
  [AudioContainer.Wav, (head) => holds(head, "RIFF") && holds(head, "WAVE", 8)],
  [
    AudioContainer.Aiff,
    (head) =>
      holds(head, "FORM") && (holds(head, "AIFF", 8) || holds(head, "AIFC", 8)),
  ],
];

/** The container `head`, a file's first bytes, starts, if it is audio. */
export const audioContainer = (head: Uint8Array): AudioContainer | undefined =>
  SIGNATURES.find(([, starts]) => starts(head))?.[0];

/** The tags of a file in `container`. */
export const audioTags = (
  container: AudioContainer,
  read: ReadBytes,
): Promise<Result<AudioTags, SystemError>> => {
  switch (container) {
    case AudioContainer.Id3v2: {
      return id3v2Tags(read, 0);
    }
    case AudioContainer.Mpeg: {
      return Promise.resolve(Ok(audioTagsOf(NOTHING_SAID)));
    }
    case AudioContainer.Flac: {
      return flacTags(read);
    }
    case AudioContainer.Ogg: {
      return oggTags(read);
    }
    case AudioContainer.Mp4: {
      return mp4Tags(read);
    }
    case AudioContainer.Wav: {
      return wavTags(read);
    }
    case AudioContainer.Aiff: {
      return aiffTags(read);
    }
  }
};
