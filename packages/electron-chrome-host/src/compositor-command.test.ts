import { describe, expect, it } from "bun:test";

import { compositorCommand } from "./compositor-command";

const paths = {
  chromeSocket: "/run/user/1000/domicile-abc/chrome.sock",
  configFile: "/run/user/1000/domicile-abc/config.json",
  program: "domicile-compositor",
  sessionFile: "/run/user/1000/domicile-abc/session.json",
};

describe("compositorCommand", () => {
  it("names every path the compositor will not guess", () => {
    // The compositor reads nothing from the environment and defaults no path,
    // so a flag missing here is a compositor that refuses to start.
    expect(compositorCommand({ ...paths, present: false })).toEqual({
      args: [
        "--chrome-socket",
        "/run/user/1000/domicile-abc/chrome.sock",
        "--session",
        "/run/user/1000/domicile-abc/session.json",
        "--config",
        "/run/user/1000/domicile-abc/config.json",
      ],
      program: "domicile-compositor",
    });
  });

  it("asks for a window when the shell wants one", () => {
    expect(compositorCommand({ ...paths, present: true }).args).toContain(
      "--present",
    );
  });

  it("leaves the config out when the shell has nothing to say", () => {
    // Distinct from an empty config file: absent means the compositor's own
    // defaults, and a shell that writes no config should not have to invent
    // one to say so.
    const { args } = compositorCommand({
      chromeSocket: paths.chromeSocket,
      present: false,
      program: paths.program,
      sessionFile: paths.sessionFile,
    });
    expect(args).not.toContain("--config");
  });
});
