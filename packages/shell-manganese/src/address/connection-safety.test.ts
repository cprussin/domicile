import { describe, expect, it } from "bun:test";

import { ConnectionSafety, connectionSafety } from "./connection-safety";

describe("connectionSafety", () => {
  it("reads the four verdicts the browser reports", () => {
    expect(connectionSafety("secure")).toBe(ConnectionSafety.Secure);
    expect(connectionSafety("warning")).toBe(ConnectionSafety.Warning);
    expect(connectionSafety("dangerous")).toBe(ConnectionSafety.Dangerous);
    expect(connectionSafety("neutral")).toBe(ConnectionSafety.Neutral);
  });

  // THE EMPTY STRING IS NOT A VERDICT. It is what the element reports before
  // the browser has said anything — a guest still on its initial entry — and
  // reading it as "neutral" would be the chrome making a claim nobody checked.
  it("says nothing has been stated for a page the browser has not judged", () => {
    expect(connectionSafety("")).toBe(ConnectionSafety.Unstated);
  });

  // AND NEITHER IS A MISSING PROPERTY. An engine older than this contract has
  // no `security` on the element at all, so what a chrome reads is
  // `undefined` — and a lock drawn from that would be a lock drawn from
  // nothing at all.
  it("says nothing has been stated on an engine that cannot say", () => {
    expect(connectionSafety(undefined)).toBe(ConnectionSafety.Unstated);
  });

  // The same rule for a level this shell has never heard of, which is what a
  // NEWER engine reporting a fifth verdict looks like from here. Guessing
  // which of the four it resembles is how a `dangerous` becomes a padlock.
  it("says nothing has been stated for a verdict it does not know", () => {
    expect(connectionSafety("catastrophic")).toBe(ConnectionSafety.Unstated);
  });
});
