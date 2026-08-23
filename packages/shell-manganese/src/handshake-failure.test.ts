import { describe, expect, it } from "bun:test";
import { HandshakeFailure } from "@domicile/chrome-sdk/bridge";

import { handshakeFailed } from "./handshake-failure";

describe("handshakeFailed", () => {
  it("names both versions and stops the shell", () => {
    // A version mismatch is the compositor and the chrome having been built
    // from different commits, so both numbers are the message: either alone
    // says a version is wrong without saying which pair disagrees.
    //
    // Both effects are pinned. The chrome draws nothing until it has been
    // told a desktop and a refused handshake carries none, so without the
    // non-zero exit this is a blank window that succeeded.
    const failures: [string, number][] = [];

    handshakeFailed((line, code) => {
      failures.push([line, code]);
    })(HandshakeFailure.VersionMismatch({ chrome: 14, host: 13 }));

    expect(failures).toStrictEqual([
      [
        "domicile: protocol version mismatch: chrome speaks 14, host speaks 13\n",
        1,
      ],
    ]);
  });
});
