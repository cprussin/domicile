import { describe, expect, it } from "bun:test";

import { decodeBase64ToBytes } from "./frame";

describe("decodeBase64ToBytes", () => {
  it("decodes base64 into the exact bytes", () => {
    // "AAECAwQFBgc=" is bytes 0..7
    expect([...decodeBase64ToBytes("AAECAwQFBgc=")]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("round-trips an RGBA pixel", () => {
    const opaqueRed = [255, 0, 0, 255];
    const base64 = Buffer.from(opaqueRed).toString("base64");
    expect([...decodeBase64ToBytes(base64)]).toEqual(opaqueRed);
  });
});
