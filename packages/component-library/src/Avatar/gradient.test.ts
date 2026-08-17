import { describe, expect, it } from "bun:test";

import { getGradient } from "./gradient";

describe(getGradient, () => {
  it("returns a linear-gradient string", () => {
    const gradient = getGradient("Ada Lovelace");
    expect(gradient.startsWith("linear-gradient(135deg")).toBe(true);
  });

  it("produces a stable gradient for the same input", () => {
    expect(getGradient("Ada Lovelace")).toBe(getGradient("Ada Lovelace"));
  });

  it("normalises case and whitespace before hashing", () => {
    expect(getGradient("Ada Lovelace")).toBe(getGradient("  ada lovelace  "));
  });

  it("produces different gradients for different names", () => {
    expect(getGradient("Ada Lovelace")).not.toBe(getGradient("Grace Hopper"));
    expect(getGradient("a")).not.toBe(getGradient("b"));
  });

  it("returns a gradient for blank names", () => {
    expect(getGradient("").startsWith("linear-gradient(135deg")).toBe(true);
  });

  it("emits three hsl stops at fixed positions", () => {
    const gradient = getGradient("Ada Lovelace");
    expect(gradient).toContain("0%");
    expect(gradient).toContain("55%");
    expect(gradient).toContain("100%");
  });
});
