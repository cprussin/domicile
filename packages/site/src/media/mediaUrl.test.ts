import { describe, expect, test } from "bun:test";

import { mediaUrl } from "./mediaUrl";

const captured = (file: string): Uint8Array | undefined =>
  file === "hero.png" ? new TextEncoder().encode("hello\n") : undefined;

describe("mediaUrl", () => {
  // The same key `.github/scripts/docs-media-upload.sh` uploads it under:
  // the first 16 hex digits of its SHA-256, then its name.
  test("a captured file is on the media host under its hash", () => {
    expect(mediaUrl("hero.png", captured)).toBe(
      "https://media.domicile-desktop.com/5891b5b522d5df08/hero.png",
    );
  });

  test("a file not captured yet has no URL", () => {
    expect(mediaUrl("hero.mp4", captured)).toBeUndefined();
  });
});
