import { describe, expect, it } from "bun:test";

import { readEnvironment } from "./environment";

describe(readEnvironment, () => {
  it("keeps the XDG directories and drops the rest", () => {
    expect(
      readEnvironment({
        PATH: "/bin",
        XDG_CACHE_HOME: "/c",
        XDG_CONFIG_HOME: "/f",
      }),
    ).toEqual({ XDG_CACHE_HOME: "/c", XDG_CONFIG_HOME: "/f" });
  });
});
