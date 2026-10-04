import { describe, expect, it } from "bun:test";
import type { DomicileFilePreview } from "@domicile-desktop/sdk/domicile-host";
import { FilePreview } from "@domicile-desktop/sdk/file-preview";

import { previewOf } from "./preview-of";

/** An answer of `kind` with nothing in it, as the engine fills one. */
const answer = (
  kind: string,
  fields: Partial<DomicileFilePreview> = {},
): DomicileFilePreview => ({
  album: "",
  artist: "",
  cover: "",
  duration: 0,
  entries: [],
  kind,
  text: "",
  title: "",
  ...fields,
});

describe("previewOf", () => {
  it("is the front of a text file", () => {
    expect(previewOf(answer("text", { text: "ay" }))).toEqual(
      FilePreview.Text("ay"),
    );
  });

  it("is the front of a directory", () => {
    expect(previewOf(answer("directory", { entries: ["a/", "b"] }))).toEqual(
      FilePreview.Directory(["a/", "b"]),
    );
  });

  it("is a song's tags, a tag it does not say read as none", () => {
    expect(
      previewOf(answer("audio", { artist: "Kate Bush", duration: 300 })),
    ).toEqual(
      FilePreview.Audio({
        album: undefined,
        artist: "Kate Bush",
        cover: undefined,
        duration: 300,
        title: undefined,
      }),
    );
  });

  it("is nothing to show for a binary or unreadable file", () => {
    expect(previewOf(answer("binary"))).toEqual(FilePreview.Binary());
    expect(previewOf(answer("unreadable"))).toEqual(FilePreview.Unreadable());
  });

  it("throws for a kind it has no name for", () => {
    expect(() => previewOf(answer("hologram"))).toThrow();
  });
});
