import { describe, expect, it } from "bun:test";

import { socketFailed } from "./socket-failure";

describe("socketFailed", () => {
  it("names the socket and stops the shell", () => {
    // Without a listener at all, Node turns the `'error'` event into an
    // uncaught exception and the shell dies on a `PipeConnectWrap` stack —
    // which is what happened every time it was started without the compositor.
    // Both effects are pinned: a message saying which socket, and a non-zero
    // exit rather than a window that never appears.
    const failures: [string, number][] = [];

    socketFailed(
      (line, code) => failures.push([line, code]),
      "/run/user/1000/domicile.sock",
    )(new Error("connect ENOENT"));

    expect(failures).toStrictEqual([
      [
        "domicile: the compositor socket at /run/user/1000/domicile.sock failed: connect ENOENT\n",
        1,
      ],
    ]);
  });
});
