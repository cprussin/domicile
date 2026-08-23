import { describe, expect, it } from "bun:test";

import { chromeSocketPath, socketPathFrom } from "./socket-path";

describe("socketPathFrom", () => {
  it("takes the path off the switch the main process passed", () => {
    // Electron appends `additionalArguments` after its own, and a Chromium
    // command line is full of switches that are not this one.
    expect(
      socketPathFrom([
        "electron",
        "--enable-features=Something",
        "--domicile-chrome-socket=/run/user/1000/domicile-chrome.sock",
      ]),
    ).toBe("/run/user/1000/domicile-chrome.sock");
  });

  it("refuses a renderer that was never told", () => {
    // A page whose socket is silently the empty string connects to nothing and
    // waits forever, which reads as a compositor that never answered.
    expect(() => socketPathFrom(["electron"])).toThrow(
      "the renderer was started without",
    );
  });
});

describe("chromeSocketPath", () => {
  it("takes the socket the runner named", () => {
    expect(
      chromeSocketPath({ DOMICILE_CHROME_SOCKET: "/tmp/dom/chrome.sock" }),
    ).toBe("/tmp/dom/chrome.sock");
  });

  it("falls back to the well-known name in the runtime directory", () => {
    expect(chromeSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(
      "/run/user/1000/domicile-chrome.sock",
    );
  });

  it("falls back to the working directory when there is no runtime one", () => {
    // A Unix socket path is capped near 108 bytes (SUN_LEN), so the fallback
    // is the shortest thing that can still be a path rather than, say, /tmp
    // plus whatever the session called itself.
    expect(chromeSocketPath({})).toBe("domicile-chrome.sock");
  });
});
