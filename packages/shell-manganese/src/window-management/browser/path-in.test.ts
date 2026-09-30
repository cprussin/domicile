import { describe, expect, it } from "bun:test";

import { pathIn } from "./path-in";

describe("pathIn", () => {
  it("puts the name inside the directory", () => {
    expect(pathIn("Documents/2026", "report.pdf")).toBe(
      "Documents/2026/report.pdf",
    );
    expect(pathIn("/mnt/usb", "photo.png")).toBe("/mnt/usb/photo.png");
  });

  // Home is the empty path, and a leading slash would make the answer an
  // absolute path — somewhere else entirely.
  it("is the name alone in home", () => {
    expect(pathIn("", "report.pdf")).toBe("report.pdf");
  });

  it("is one slash under the root", () => {
    expect(pathIn("/", "tmp")).toBe("/tmp");
  });
});
