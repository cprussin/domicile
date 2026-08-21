import { describe, expect, it } from "bun:test";

import { socketPathFrom } from "./socket-path";

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
