import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mediaUrl } from "./mediaUrl";

const dir = mkdtempSync(join(tmpdir(), "media-"));
writeFileSync(join(dir, "hero.png"), "hello\n");
afterAll(() => {
  rmSync(dir, { recursive: true });
});

describe("mediaUrl", () => {
  // The same key `.github/scripts/docs-media-upload.sh` uploads it under:
  // the first 16 hex digits of its SHA-256, then its name.
  test("a captured file is on the media host under its hash", () => {
    expect(mediaUrl("hero.png", dir)).toBe(
      "https://media.domicile-desktop.com/5891b5b522d5df08/hero.png",
    );
  });

  test("a file not captured yet has no URL", () => {
    expect(mediaUrl("hero.mp4", dir)).toBeUndefined();
  });
});
