import { describe, expect, it } from "bun:test";

import { configPath, parseShellConfig } from "./shell-config";

describe("parseShellConfig", () => {
  it("takes the desktop and whether it is on a screen", () => {
    expect(
      parseShellConfig('{ "present": false, "desktop": { "maxScale": 1 } }'),
    ).toEqual({ desktop: { maxScale: 1 }, present: false });
  });

  it("puts the desktop on a screen unless told otherwise", () => {
    // What running a shell means: a user typed its name. Headless is the
    // arrangement the checks in this repo drive, and is asked for.
    expect(parseShellConfig("{}")).toEqual({ desktop: {}, present: true });
  });

  it("refuses a config it cannot read rather than starting without it", () => {
    // The alternative is a desktop that comes up wearing defaults, which looks
    // like the settings did not take rather than like the file is broken.
    expect(() => parseShellConfig("{ nope")).toThrow();
  });
});

describe("configPath", () => {
  it("is where XDG says a program's config goes", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/home/me/.config" })).toBe(
      "/home/me/.config/domicile/manganese.json",
    );
  });

  it("refuses an environment with neither", () => {
    // Not the working directory: a process with no config home is not a user
    // session, and reading a config out of wherever the shell was started
    // from is worse than saying so.
    expect(() => configPath({})).toThrow("nowhere to read a config from");
  });

  it("falls back to the default config home", () => {
    expect(configPath({ HOME: "/home/me" })).toBe(
      "/home/me/.config/domicile/manganese.json",
    );
  });
});
