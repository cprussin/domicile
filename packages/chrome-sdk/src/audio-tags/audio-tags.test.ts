import { describe, expect, it } from "bun:test";

import { AudioContainer, audioContainer } from "./audio-tags";

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
    ),
  );

describe("audioContainer", () => {
  it("knows each container by its first bytes", () => {
    expect(
      [
        bytes("ID3", [4, 0, 0, 0, 0, 0, 0]),
        bytes([0xff, 0xfb, 0x90, 0x00]),
        bytes("fLaC", [0, 0, 0, 34]),
        bytes("OggS", [0, 2]),
        bytes([0, 0, 0, 32], "ftypM4A "),
        bytes("RIFF", [0, 0, 0, 0], "WAVE"),
        bytes("FORM", [0, 0, 0, 0], "AIFF"),
        bytes("FORM", [0, 0, 0, 0], "AIFC"),
      ].map(audioContainer),
    ).toStrictEqual([
      AudioContainer.Id3v2,
      AudioContainer.Mpeg,
      AudioContainer.Flac,
      AudioContainer.Ogg,
      AudioContainer.Mp4,
      AudioContainer.Wav,
      AudioContainer.Aiff,
      AudioContainer.Aiff,
    ]);
  });

  it("knows text that starts like a container is not one", () => {
    expect(
      [
        bytes("ID3 is a tag format\n"),
        bytes("fLaC is a word\n"),
        bytes("OggS!"),
        bytes("RIFF raff WAVE"),
        bytes("in Music/notes.mp3\n"),
        bytes(""),
      ].map(audioContainer),
    ).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
