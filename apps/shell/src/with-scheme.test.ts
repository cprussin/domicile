import { describe, expect, it } from "bun:test";

import { withScheme } from "./with-scheme";

describe("withScheme", () => {
  it("loads a bare address over https, the way an address bar does", () => {
    expect(withScheme("example.com")).toBe("https://example.com");
  });

  it("leaves an address that already names a scheme alone", () => {
    expect(withScheme("http://example.com")).toBe("http://example.com");
    expect(withScheme("about:blank")).toBe("about:blank");
  });
});
