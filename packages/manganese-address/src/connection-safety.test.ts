import { describe, expect, it } from "bun:test";

import { ConnectionSafety, connectionSafety } from "./connection-safety";

describe("connectionSafety", () => {
  it("reads the four verdicts the browser reports", () => {
    expect(connectionSafety("secure")).toBe(ConnectionSafety.Secure);
    expect(connectionSafety("warning")).toBe(ConnectionSafety.Warning);
    expect(connectionSafety("dangerous")).toBe(ConnectionSafety.Dangerous);
    expect(connectionSafety("neutral")).toBe(ConnectionSafety.Neutral);
  });

  // An empty string is what a guest on its initial entry reports. Reading it
  // as "neutral" would claim something nobody checked.
  it("says nothing has been stated for a page the browser has not judged", () => {
    expect(connectionSafety("")).toBe(ConnectionSafety.Unstated);
  });

  // Older engines do not set the property at all.
  it("says nothing has been stated on an engine that cannot say", () => {
    expect(connectionSafety(undefined)).toBe(ConnectionSafety.Unstated);
  });

  // A newer engine's unknown level. Guessing could show `dangerous` as safe.
  it("says nothing has been stated for a verdict it does not know", () => {
    expect(connectionSafety("catastrophic")).toBe(ConnectionSafety.Unstated);
  });
});
