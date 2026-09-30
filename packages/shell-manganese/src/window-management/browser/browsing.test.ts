import { describe, expect, it } from "bun:test";

import { browsing, parentOf, typedOf } from "./browsing";

describe("browsing", () => {
  // Anything that is not a path is a search of the home's index.
  it("is nothing for a query that is not a path", () => {
    expect(browsing("")).toBeUndefined();
    expect(browsing("notes")).toBeUndefined();
    expect(browsing("~someone")).toBeUndefined();
  });

  it("reads a path under the home as one relative to it", () => {
    expect(browsing("~")).toStrictEqual({
      directory: "",
      filter: "",
      typed: "~/",
    });
    expect(browsing("~/Pic")).toStrictEqual({
      directory: "",
      filter: "Pic",
      typed: "~/",
    });
    expect(browsing("~/Pictures/2026/ca")).toStrictEqual({
      directory: "Pictures/2026",
      filter: "ca",
      typed: "~/Pictures/2026/",
    });
  });

  it("reads an absolute path as itself", () => {
    expect(browsing("/")).toStrictEqual({
      directory: "/",
      filter: "",
      typed: "/",
    });
    expect(browsing("/usr/sh")).toStrictEqual({
      directory: "/usr",
      filter: "sh",
      typed: "/usr/",
    });
  });

  // The engine refuses a path that climbs, so one typed is resolved here —
  // and never above where it started.
  it("resolves `..` and `.` and doubled slashes", () => {
    expect(browsing("/usr/../etc//./x")?.directory).toBe("/etc");
    expect(browsing("/../")?.directory).toBe("/");
    expect(browsing("~/Pictures/../../")?.directory).toBe("");
  });
});

describe("parentOf", () => {
  it("is the directory above, as typed", () => {
    expect(parentOf("~/Pictures/2026/")).toBe("~/Pictures/");
    expect(parentOf("~/Pictures/")).toBe("~/");
    expect(parentOf("/usr/")).toBe("/");
  });

  it("is nothing at the top", () => {
    expect(parentOf("~/")).toBeUndefined();
    expect(parentOf("/")).toBeUndefined();
  });
});

describe("typedOf", () => {
  // What the box says to list a directory: the way back into `browsing`.
  it("spells a path the way the box is typed to list it", () => {
    expect(typedOf("")).toBe("~/");
    expect(typedOf("Pictures/2026")).toBe("~/Pictures/2026/");
    expect(typedOf("/")).toBe("/");
    expect(typedOf("/mnt/usb")).toBe("/mnt/usb/");
  });
});
