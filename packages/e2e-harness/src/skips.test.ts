import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { skipFaults } from "./skips";

/** Where the checks live, from this file. */
const SCRIPTS = join(import.meta.dir, "..", "..", "..", "scripts");

/**
 * Every script in `scripts/`, as `[name, contents]`.
 *
 * Does not recurse, which leaves out the sourced `lib/harness.sh`.
 */
const shellScripts = (): [string, string][] =>
  readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".sh"))
    .map((name) => [name, readFileSync(join(SCRIPTS, name), "utf8")]);

describe("a skip that says why", () => {
  // `check.sh` reads the reason with `sed -n 's/^ *SKIP: *//p'`, so it shows
  // no reason printed any other way.
  for (const [name, script] of shellScripts()) {
    it(`${name} prints a reason for every skip`, () => {
      expect(skipFaults(script)).toStrictEqual([]);
    });
  }

  it("catches a bare exit 77", () => {
    expect(skipFaults('echo "no weston here"\nexit 77\n')).toStrictEqual([
      "2: exits 77 without a SKIP: line for check.sh to read",
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
    // `check.sh` anchors the prefix to the start of a line.
    expect(
      skipFaults('echo "this would SKIP: if weston were absent"\nexit 77\n'),
    ).toStrictEqual(["2: exits 77 without a SKIP: line for check.sh to read"]);
  });

  it("ignores an exit 77 that is only described in a comment", () => {
    expect(
      skipFaults("# bails with exit 77 when weston is missing\n"),
    ).toStrictEqual([]);
  });
});
