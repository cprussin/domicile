import { describe, expect, it } from "bun:test";

import { listenWindowMs, requireSocketPath } from "./chrome-socket";

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

describe("listenWindowMs", () => {
  it("defaults when the variable is unset", () => {
    expect(listenWindowMs({})).toBe(6000);
  });

  it("takes the configured window", () => {
    expect(listenWindowMs({ DOMICILE_CHROME_LISTEN_MS: "25000" })).toBe(25_000);
  });

  it("throws on a value that is not a positive number", () => {
    // Left unchecked this reaches `setTimeout` as NaN, which fires at once —
    // a harness that exits immediately looks exactly like one that saw nothing.
    expect(() => listenWindowMs({ DOMICILE_CHROME_LISTEN_MS: "soon" })).toThrow(
      /DOMICILE_CHROME_LISTEN_MS/,
    );
    expect(() => listenWindowMs({ DOMICILE_CHROME_LISTEN_MS: "0" })).toThrow(
      /DOMICILE_CHROME_LISTEN_MS/,
    );
  });
});
