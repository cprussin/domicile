import { describe, expect, it } from "bun:test";

import { PROTOCOL_VERSION } from "./protocol";

/**
 * The two halves of the wire contract, checked against each other.
 *
 * `packages/domicile-protocol` and this package are one protocol written
 * twice, and `negotiate` requires the two numbers to be *equal* — a chrome
 * that says 7 to a host speaking 8 gets no `welcome`, and every message it
 * sends afterwards is dropped on the floor. The desktop does not start.
 *
 * Nothing else catches that. Every Rust test reads the Rust constant and every
 * test here reads this one, so both suites stay green while the product is
 * dead. This is the only check that fails when half the contract moves.
 */
const RUST_CONSTANT = /^pub const PROTOCOL_VERSION: u32 = (\d+);$/m;

describe("the protocol version", () => {
  it("is the same number on both sides of the wire", async () => {
    const crate = await Bun.file(
      new URL("../../domicile-protocol/src/lib.rs", import.meta.url),
    ).text();
    const found = RUST_CONSTANT.exec(crate);

    // Not `?.[1]`: a rename in the crate that stopped this matching would make
    // the assertion below compare against `undefined` and pass nothing, which
    // is the same silence this test exists to break.
    expect(found).not.toBeNull();
    expect(Number(found?.[1])).toBe(PROTOCOL_VERSION);
  });
});
