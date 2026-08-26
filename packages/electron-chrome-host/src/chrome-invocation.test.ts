import { describe, expect, it } from "bun:test";

import {
  argumentsFrom,
  chromeArguments,
  chromeEnvironment,
} from "./chrome-invocation";

const session = {
  chromeSocket: "/run/user/1000/domicile-abc/chrome.sock",
  chromeWaylandDisplay: "wayland-3-chrome",
  composited: true,
  protocol: 1,
  waylandDisplay: "wayland-3",
};

describe("chromeEnvironment", () => {
  it("puts the chrome's window on the display the compositor made for it", () => {
    // Not the display apps connect to: which socket a client arrived on is how
    // the compositor tells the desktop from the things running on it.
    expect(
      chromeEnvironment(session, { PATH: "/usr/bin" }).WAYLAND_DISPLAY,
    ).toBe("wayland-3-chrome");
  });

  it("leaves the session's own display alone when nothing is composited", () => {
    // Headless: the chrome's window is an ordinary one on whatever desktop the
    // user is already running, and pointing it at a compositor that draws
    // nothing would give it a display with no screen behind it.
    expect(
      chromeEnvironment(
        { ...session, composited: false },
        { WAYLAND_DISPLAY: "wayland-0" },
      ).WAYLAND_DISPLAY,
    ).toBe("wayland-0");
  });

  it("lets Electron be Electron again", () => {
    // The `bin` stub sets `ELECTRON_RUN_AS_NODE` so the *launcher* is a Node
    // process with no display connection. Inherited, it would make the chrome
    // one too — and Electron-as-Node loads `main.js` as an ordinary ES module,
    // where `import { ipcMain } from "electron"` is a missing export and the
    // desktop dies before its window exists.
    expect(
      chromeEnvironment(session, { ELECTRON_RUN_AS_NODE: "1" }),
    ).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
  });

  it("carries the session so the chrome need not be told twice", () => {
    const published = chromeEnvironment(session, {}).DOMICILE_SESSION;
    expect(JSON.parse(published ?? "")).toMatchObject({
      chrome_socket: "/run/user/1000/domicile-abc/chrome.sock",
    });
  });
});

describe("chromeArguments", () => {
  it("keeps Electron on Wayland when the compositor is drawing", () => {
    // Without it Electron defaults to X11 and puts the chrome on the host
    // session's desktop rather than inside the compositor it is the chrome of.
    expect(chromeArguments(session, [])).toContain("--ozone-platform=wayland");
  });

  it("says nothing about the platform when there is no window to be in", () => {
    expect(chromeArguments({ ...session, composited: false }, [])).toEqual([]);
  });

  it("passes on what the machine asked for", () => {
    // Whether a host can give Chromium a usable namespace sandbox is the
    // machine's to say, which is why it is not something a shell can ask for
    // itself.
    expect(chromeArguments(session, ["--no-sandbox"])).toContain(
      "--no-sandbox",
    );
  });
});

describe("argumentsFrom", () => {
  it("splits a machine's extra arguments on whitespace", () => {
    expect(argumentsFrom("--no-sandbox  --disable-gpu")).toEqual([
      "--no-sandbox",
      "--disable-gpu",
    ]);
  });

  it("takes an unset or empty variable as nothing to add", () => {
    // Distinct: a packager who set it to "" meant no flags, and an argument
    // list holding one empty string is one Electron refuses to start on.
    expect(argumentsFrom(undefined)).toEqual([]);
    expect(argumentsFrom("   ")).toEqual([]);
  });
});
