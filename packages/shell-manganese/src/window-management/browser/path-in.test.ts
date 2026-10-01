import { describe, expect, it } from "bun:test";

import { pathIn } from "./path-in";

describe("pathIn", () => {
  it("puts the name inside the directory", () => {
    expect(pathIn("/mnt/usb", "photo.png")).toBe("/mnt/usb/photo.png");
  });

  it("is one slash under the root", () => {
    expect(pathIn("/", "tmp")).toBe("/tmp");
  });
});
