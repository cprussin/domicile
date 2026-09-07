import { describe, expect, it } from "bun:test";

import { fileForRequest } from "./static-path";

const ROOT = "/srv/shell";

describe("fileForRequest", () => {
  it("serves a file inside the root", () => {
    expect(fileForRequest(ROOT, "/assets/main.js")).toBe(
      "/srv/shell/assets/main.js",
    );
  });

  it("serves index.html for the root itself", () => {
    expect(fileForRequest(ROOT, "/")).toBe("/srv/shell/index.html");
  });

  it("serves index.html for a directory", () => {
    expect(fileForRequest(ROOT, "/panels/")).toBe(
      "/srv/shell/panels/index.html",
    );
  });

  // The whole reason this is its own module. A desktop's page is served to a
  // browser; a path that escapes the root serves the machine.
  it.each([
    ["a parent traversal", "/../../etc/passwd"],
    ["one buried in the middle", "/assets/../../../etc/passwd"],
    ["an encoded traversal", "/%2e%2e%2f%2e%2e%2fetc%2fpasswd"],
    ["a doubly encoded one", "/%252e%252e%252fetc%252fpasswd"],
    ["a NUL truncation", "/index.html\0.png"],
    ["broken encoding", "/%"],
  ])("refuses %s", (_name, requestPath) => {
    const resolved = fileForRequest(ROOT, requestPath);
    expect(
      resolved === undefined || resolved.startsWith("/srv/shell/"),
    ).toBeTrue();
  });

  // Clamped, not escaped, and not refused either: an absolute path's `..` at
  // the top has nowhere above to go, so this names a directory inside the root
  // that probably does not exist. The server answers 404 and that is right —
  // refusing it here would be refusing a legal path for the wrong reason.
  it("clamps a parent traversal at the root rather than escaping it", () => {
    expect(fileForRequest("/srv/shell", "/../shell-other/index.html")).toBe(
      "/srv/shell/shell-other/index.html",
    );
  });

  it("keeps the root itself, with no trailing separator, inside", () => {
    expect(fileForRequest(ROOT, "/index.html")).toBe("/srv/shell/index.html");
  });
});
