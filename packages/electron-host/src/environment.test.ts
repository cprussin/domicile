import { describe, expect, it } from "bun:test";

import { readEnvironment } from "./environment";

describe(readEnvironment, () => {
  it("keeps the XDG directories and the engine's socket, and drops the rest", () => {
    expect(
      readEnvironment({
        DOMICILE_ELECTRON_SOCK: "/run/d/electron.sock",
        PATH: "/bin",
        XDG_CACHE_HOME: "/c",
        XDG_CONFIG_HOME: "/f",
      }),
    ).toEqual({
      DOMICILE_ELECTRON_SOCK: "/run/d/electron.sock",
      XDG_CACHE_HOME: "/c",
      XDG_CONFIG_HOME: "/f",
    });
  });
});
