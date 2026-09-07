import { describe, expect, it } from "bun:test";

import { Err, Ok } from "@cprussin/option-result";

import {
  readShellManifest,
  ShellManifestError,
  ShellManifestProblem,
} from "./shell-manifest";

const read = (manifest: unknown, name = "my-desktop") =>
  readShellManifest(JSON.stringify(manifest), name);

/** The variant, for the cases that are about which one and not about its fields. */
const problemOf = (result: ReturnType<typeof readShellManifest>) =>
  result.match({
    Err: (error: ShellManifestError) => error.kind,
    Ok: () => "it was accepted",
  });

/** What the bad field held, so the expectation names it rather than restating it. */
const foundIn = (manifest: unknown, field: string) => {
  const value = (manifest as Record<string, unknown>)[field];
  const found = Array.isArray(value) ? value[0] : value;
  if (found === null) {
    return "null";
  }
  return Array.isArray(found) ? "an array" : typeof found;
};

describe("readShellManifest", () => {
  it("takes a module and generates the document", () => {
    expect(read({ module: "dist/shell.js", name: "my-desktop" })).toStrictEqual(
      Ok({ module: "dist/shell.js", name: "my-desktop", styles: [] }),
    );
  });

  it("takes stylesheets beside the module", () => {
    expect(
      read({
        module: "dist/shell.js",
        styles: ["dist/shell.css", "dist/theme.css"],
      }),
    ).toStrictEqual(
      Ok({
        module: "dist/shell.js",
        name: "my-desktop",
        styles: ["dist/shell.css", "dist/theme.css"],
      }),
    );
  });

  // A shell that does not name itself is called after where it was found,
  // which is what a person would call it anyway.
  it("falls back to the name it was found under", () => {
    expect(read({ module: "shell.js" }, "some-directory")).toStrictEqual(
      Ok({ module: "shell.js", name: "some-directory", styles: [] }),
    );
  });

  // A manifest with no module has not said what to load, and there is nothing
  // to guess from: `index.js` would be a convention this contract does not
  // have, and looking for one file in the directory would be the directory
  // shape the manifest exists to avoid.
  it("refuses a manifest with no module", () => {
    expect(read({ name: "nothing-here" })).toStrictEqual(
      Err(ShellManifestError.NoModule()),
    );
  });

  it.each([
    ["a manifest that is not JSON", "{oh dear"],
    ["an empty file", ""],
  ])("refuses %s", (_, text) => {
    expect(problemOf(readShellManifest(text, "x"))).toBe(
      ShellManifestProblem.NotJson,
    );
  });

  it.each([
    ["an array", "[]"],
    ["a string", '"a shell"'],
    ["a number", "3"],
    ["null", "null"],
  ])("refuses %s at the top level", (_, text) => {
    expect(problemOf(readShellManifest(text, "x"))).toBe(
      ShellManifestProblem.NotAnObject,
    );
  });

  it.each([
    ["name", { module: "a.js", name: 3 }],
    ["module", { module: 3 }],
    ["styles", { module: "a.js", styles: "one.css" }],
    ["styles", { module: "a.js", styles: [3] }],
  ])("refuses a %s that is the wrong type", (field, manifest) => {
    expect(read(manifest)).toStrictEqual(
      Err(ShellManifestError.BadField(field, foundIn(manifest, field))),
    );
  });

  // Everything a manifest names gets served, so a manifest that can name a
  // path outside the shell is a manifest that can serve the machine. The same
  // reasoning as `static-path.ts`, one layer earlier — and this layer is the
  // one where the author is trusted less than the request, which is backwards
  // from how it looks.
  it.each([
    ["a parent traversal", "../../etc/passwd"],
    ["one buried in the middle", "dist/../../../etc/passwd"],
    ["a bare parent", ".."],
    ["an absolute path", "/etc/passwd"],
    ["a path that is only dots", "./././"],
    ["an empty path", ""],
  ])("refuses %s as a module", (_, module) => {
    expect(read({ module })).toStrictEqual(
      Err(ShellManifestError.EscapesTheShell("module", module)),
    );
  });

  it("refuses a traversal in a stylesheet too", () => {
    expect(
      read({ module: "a.js", styles: ["../../etc/passwd"] }),
    ).toStrictEqual(
      Err(ShellManifestError.EscapesTheShell("styles", "../../etc/passwd")),
    );
  });

  // `a/../b` never leaves, and refusing it would refuse a path a bundler can
  // legitimately produce.
  it("allows a traversal that stays inside", () => {
    expect(read({ module: "dist/../dist/shell.js" })).toStrictEqual(
      Ok({ module: "dist/shell.js", name: "my-desktop", styles: [] }),
    );
  });

  // An absolute path is not a different case from a traversal: it is a path
  // that means something other than "inside the shell", and normalising it to
  // a relative one would silently serve a different file than the author named.
  it("normalises a leading ./ away rather than treating it as a segment", () => {
    expect(read({ module: "./dist/shell.js" })).toStrictEqual(
      Ok({ module: "dist/shell.js", name: "my-desktop", styles: [] }),
    );
  });
});
