import { describe, expect, it } from "bun:test";

import { parseSession, sessionDocument } from "./compositor-session";

const published = JSON.stringify({
  chrome_socket: "/run/user/1000/domicile-abc/chrome.sock",
  chrome_wayland_display: "wayland-3-chrome",
  composited: true,
  protocol: 17,
  wayland_display: "wayland-3",
});

describe("parseSession", () => {
  it("reads what the compositor published", () => {
    expect(parseSession(published)).toEqual({
      chromeSocket: "/run/user/1000/domicile-abc/chrome.sock",
      chromeWaylandDisplay: "wayland-3-chrome",
      composited: true,
      protocol: 17,
      waylandDisplay: "wayland-3",
    });
  });

  it("refuses a document missing something the shell needs", () => {
    // Not a case to soften: a shell that carried on without a display would
    // put its window on the session's own desktop rather than inside the
    // compositor it is the chrome of, which looks like a rendering bug.
    const { chrome_wayland_display: _, ...rest } = JSON.parse(published);
    expect(() => parseSession(JSON.stringify(rest))).toThrow();
  });

  it("refuses a document that is not the shape it claims", () => {
    expect(() =>
      parseSession(
        JSON.stringify({ ...JSON.parse(published), protocol: "17" }),
      ),
    ).toThrow();
  });

  it("refuses a half-written document", () => {
    // Published by rename, so this should be unreachable — and if the rename
    // ever stops being atomic, a parse error naming the file beats a shell
    // that connects to a truncated socket path.
    expect(() => parseSession(published.slice(0, 20))).toThrow();
  });
});

describe("sessionDocument", () => {
  it("writes what parseSession reads", () => {
    // The launcher hands the session on to the chrome's own process, which
    // parses it with the same schema the compositor's file is parsed with:
    // one wire shape, so there is no second one to keep in step.
    const session = parseSession(published);
    expect(parseSession(sessionDocument(session))).toEqual(session);
  });
});
