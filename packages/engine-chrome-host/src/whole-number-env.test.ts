import { describe, expect, it } from "bun:test";

import { wholeNumberFromEnv } from "./whole-number-env";

/** What the entry point does, without exiting the test runner. */
const refuse = (message: string): never => {
  throw new Error(message);
};

describe("wholeNumberFromEnv", () => {
  it("reads a whole number", () => {
    expect(wholeNumberFromEnv("X", "600000", refuse)).toBe(600_000);
    expect(wholeNumberFromEnv("X", "0", refuse)).toBe(0);
  });

  it("passes an unset variable through as unset", () => {
    expect(wholeNumberFromEnv("X", undefined, refuse)).toBeUndefined();
  });

  // The one that caused this. `Number("soon")` is NaN, and a NaN deadline is
  // never in the past, so the thing waiting on it waits forever.
  it("refuses something that is not a number at all", () => {
    expect(() => wholeNumberFromEnv("X", "soon", refuse)).toThrow(
      'domicile: X must be a whole number, not "soon"',
    );
  });

  // Set-but-empty is not unset, and `Number("")` is 0 — a budget of no
  // milliseconds, which reads as "give up immediately" rather than "unset".
  it("refuses an empty or blank value rather than reading it as zero", () => {
    expect(() => wholeNumberFromEnv("X", "", refuse)).toThrow();
    expect(() => wholeNumberFromEnv("X", "   ", refuse)).toThrow();
  });

  // Every one of these is a number to `Number()` and a typo to a person.
  it("refuses the shapes Number() would silently accept", () => {
    for (const raw of ["1e3", "0x10", "1.5", "-1", "Infinity", " 10 ", "+10"]) {
      expect(() => wholeNumberFromEnv("X", raw, refuse)).toThrow();
    }
  });
});
