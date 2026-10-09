import { describe, expect, it } from "bun:test";

import { domain } from "./domain";

describe(domain, () => {
  it("is the host without www", () => {
    expect(domain("https://www.example.com/a?b")).toBe("example.com");
  });

  it("is the whole URL for one without a host", () => {
    expect(domain("file:///home/user/a.txt")).toBe("file:///home/user/a.txt");
  });
});
