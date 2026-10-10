import { describe, expect, it } from "bun:test";
import { stemEnd } from "./stem";

describe("stemEnd", () => {
  it("ends before the last extension", () => {
    expect(stemEnd("photo.png")).toBe(5);
    expect(stemEnd("backup.tar.gz")).toBe(10);
  });

  it("takes the whole name without an extension, or with only a leading dot", () => {
    expect(stemEnd("README")).toBe(6);
    expect(stemEnd(".bashrc")).toBe(7);
  });
});
