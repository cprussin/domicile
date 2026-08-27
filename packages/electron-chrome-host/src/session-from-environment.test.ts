import { describe, expect, it } from "bun:test";

import { sessionFromEnvironment } from "./session-from-environment";

const published = JSON.stringify({
  chrome_socket: "/run/chrome.sock",
  chrome_wayland_display: "wayland-3-chrome",
  composited: true,
  protocol: 1,
  wayland_display: "wayland-3",
});

describe("sessionFromEnvironment", () => {
  it("reads the session the launcher passed down", () => {
    expect(
      sessionFromEnvironment({ DOMICILE_SESSION: published }).chromeSocket,
    ).toBe("/run/chrome.sock");
  });

  it("refuses a chrome that was started on its own", () => {
    // Not a case to recover from: the chrome is half of a desktop, and the
    // half it is missing is the one that knows where anything is. Running it
    // by hand is a mistake worth a sentence, not a window connected to
    // nothing.
    expect(() => sessionFromEnvironment({})).toThrow("DOMICILE_SESSION");
  });
});
