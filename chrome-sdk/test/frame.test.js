import { describe, it, expect } from "vitest";
import { decodeBase64ToBytes } from "../src/frame.js";

describe("decodeBase64ToBytes", () => {
  it("decodes base64 into the exact bytes", () => {
    // "AAECAwQFBgc=" is bytes 0..7
    const bytes = decodeBase64ToBytes("AAECAwQFBgc=");
    expect(Array.from(bytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("round-trips an RGBA pixel", () => {
    // one opaque red pixel [255,0,0,255] -> base64
    const b64 = Buffer.from([255, 0, 0, 255]).toString("base64");
    expect(Array.from(decodeBase64ToBytes(b64))).toEqual([255, 0, 0, 255]);
  });
});
