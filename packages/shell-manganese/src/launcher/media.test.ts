import { describe, expect, it } from "bun:test";

import { homeUrl, MediaKind, mediaOf } from "./media";

describe("mediaOf", () => {
  it("reads what a file is from its extension, in any case", () => {
    expect(mediaOf("Pictures/cat.PNG")).toBe(MediaKind.Image);
    expect(mediaOf("Videos/clip.mp4")).toBe(MediaKind.Video);
    expect(mediaOf("Music/song.flac")).toBe(MediaKind.Audio);
    expect(mediaOf("Scratch/DS11_Complete.pdf")).toBe(MediaKind.Pdf);
  });

  it("is nothing for a file the engine does not draw", () => {
    // Text, or a binary nothing on the page can show: the host's preview
    // answers for those.
    expect(mediaOf("Notes/today.org")).toBeUndefined();
    expect(mediaOf("Makefile")).toBeUndefined();
  });
});

describe("homeUrl", () => {
  it("names a path under home on the engine's home host, each segment escaped", () => {
    expect(homeUrl("Pictures/cat one#2.png")).toBe(
      "domicile://home/Pictures/cat%20one%232.png",
    );
  });
});
