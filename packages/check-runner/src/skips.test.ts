import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { skipFaults } from "./skips";

/** The repository's root, from this file. */
const ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Every check, as `[path, contents]`: `scripts/*.sh` and each package's
 * `tests/*.sh`.
 *
 * Does not recurse, which leaves out the sourced `packages/e2e-harness/lib/harness.sh`.
 */
const shellScripts = (): [string, string][] =>
  ["scripts", ...packageTests()].flatMap((directory) =>
    readdirSync(join(ROOT, directory))
      .filter((name) => name.endsWith(".sh"))
      .map((name): [string, string] => [
        join(directory, name),
        readFileSync(join(ROOT, directory, name), "utf8"),
      ]),
  );

/** Each package's `tests` directory, relative to the root. */
const packageTests = (): string[] =>
  readdirSync(join(ROOT, "packages"))
    .map((name) => join("packages", name, "tests"))
    .filter((directory) => existsSync(join(ROOT, directory)));

describe("a skip that says why", () => {
  it("scans the checks", () => {
    expect(shellScripts().map(([path]) => path)).toContain(
      "packages/check-runner/tests/test-a-passing-check-says-what-it-established.sh",
    );
  });

  // `check-runner` reads the reason with `sed -n 's/^ *SKIP: *//p'`, so it shows
  // no reason printed any other way.
  for (const [name, script] of shellScripts()) {
    it(`${name} prints a reason for every skip`, () => {
      expect(skipFaults(script)).toStrictEqual([]);
    });
  }

  it("catches a bare exit 77", () => {
    expect(skipFaults('echo "no weston here"\nexit 77\n')).toStrictEqual([
      "2: exits 77 without a SKIP: line for check-runner to read",
    ]);
  });

  it("accepts the reason on the line above", () => {
    expect(skipFaults('echo "SKIP: no weston"\nexit 77\n')).toStrictEqual([]);
  });

  it("accepts the reason and the exit on one line", () => {
    expect(
      skipFaults('command -v x || { echo "SKIP: no x"; exit 77; }\n'),
    ).toStrictEqual([]);
  });

  it("does not take a mid-sentence mention for a reason", () => {
    // `check-runner` anchors the prefix to the start of a line.
    expect(
      skipFaults('echo "this would SKIP: if weston were absent"\nexit 77\n'),
    ).toStrictEqual([
      "2: exits 77 without a SKIP: line for check-runner to read",
    ]);
  });

  it("ignores an exit 77 that is only described in a comment", () => {
    expect(
      skipFaults("# bails with exit 77 when weston is missing\n"),
    ).toStrictEqual([]);
  });
});
