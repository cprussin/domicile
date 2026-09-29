import { describe, expect, it } from "bun:test";

import { savedPath } from "./saved-path";

describe("savedPath", () => {
  it("puts the name inside the directory", () => {
    expect(savedPath("Documents/2026", "report.pdf")).toBe(
      "Documents/2026/report.pdf",
    );
  });

  // Home is the empty path, and a leading slash would make the answer an
  // absolute path, which the engine refuses.
  it("is the name alone in home", () => {
    expect(savedPath("", "report.pdf")).toBe("report.pdf");
  });
});
