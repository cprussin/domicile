import { describe, expect, it } from "bun:test";

import { PROTOCOL_VERSION } from "./protocol";

/**
 * Checks the TypeScript and Rust protocol versions match.
 *
 * `negotiate` requires equal versions, or the desktop does not start. Each
 * side's own tests read only its own constant, so only this test catches a
 * mismatch.
 */
const RUST_CONSTANT = /^pub const PROTOCOL_VERSION: u32 = (\d+);$/m;

describe("the protocol version", () => {
  it("is the same number on both sides of the wire", async () => {
    const crate = await Bun.file(
      new URL("../../domicile-protocol/src/lib.rs", import.meta.url),
    ).text();
    const found = RUST_CONSTANT.exec(crate);

    // Assert the match first, so a renamed constant fails rather than
    // comparing `undefined`.
    expect(found).not.toBeNull();
    expect(Number(found?.[1])).toBe(PROTOCOL_VERSION);
  });
});
