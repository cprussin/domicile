import { describe, expect, it } from "bun:test";

import { isSite } from "./sites";

describe(isSite, () => {
  it("takes a host, a host's subdomains, and a dotted address", () => {
    for (const site of [
      "github.com",
      "*.github.io",
      "localhost",
      "10.0.0.1",
      "news.ycombinator.com",
    ]) {
      expect(isSite(site)).toBe(true);
    }
  });

  it("refuses what Chrome cannot grant as a host", () => {
    for (const site of [
      "",
      "https://github.com",
      "github.com/login",
      ".",
      "*..",
      "github.com.",
      "-github.com",
      "foo.123",
      "1.2.3.999",
      "010.0.0.1",
      "foo.0x1f",
      "0x7f",
      "*.10.0.0.1",
    ]) {
      expect(isSite(site)).toBe(false);
    }
  });
});
