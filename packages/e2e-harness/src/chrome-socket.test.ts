import { describe, expect, it } from "bun:test";

import { requireSocketPath } from "./chrome-socket";

describe("requireSocketPath", () => {
  it("returns the configured socket path", () => {
    expect(
      requireSocketPath({ DOMICILE_CHROME_SOCK: "/tmp/chrome.sock" }),
    ).toBe("/tmp/chrome.sock");
  });

  it("throws when the variable is unset", () => {
    expect(() => requireSocketPath({})).toThrow(/DOMICILE_CHROME_SOCK/);
  });

  it("throws when the variable is empty", () => {
    expect(() => requireSocketPath({ DOMICILE_CHROME_SOCK: "" })).toThrow(
      /DOMICILE_CHROME_SOCK/,
    );
  });
});
