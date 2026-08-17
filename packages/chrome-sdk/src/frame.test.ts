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

describe("decodeBase64ToBytes at frame scale", () => {
  // A 1494x994 window is ~6MB a frame, arriving ~30 times a second on the
  // renderer's only thread — the one that also forwards keystrokes.
  const framePixels = new Uint8Array(1494 * 994 * 4);
  const frameBase64 = Buffer.from(framePixels).toString("base64");

  it("decodes a whole frame without truncating it", () => {
    expect(decodeBase64ToBytes(frameBase64)).toHaveLength(framePixels.length);
  });

  it("costs little beyond the base64 decode itself", () => {
    // Measured against `atob` in whichever runtime is running the test, because
    // its speed varies hugely: a fixed millisecond budget would be measuring
    // the test environment rather than this function. What must hold is that
    // turning the decoded string into bytes is a minor cost on top — a per-byte
    // callback instead makes it several times `atob`, which is the difference
    // between a responsive chrome and one that cannot keep up with typing.
    const beforeAtob = performance.now();
    atob(frameBase64);
    const atobMs = performance.now() - beforeAtob;

    const beforeDecode = performance.now();
    decodeBase64ToBytes(frameBase64);
    const decodeMs = performance.now() - beforeDecode;

    expect(decodeMs).toBeLessThan(atobMs * 4);
  });
});
