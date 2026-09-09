import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { skipFaults } from "./skips";

/** Where the checks live, from this file. */
const SCRIPTS = join(import.meta.dir, "..", "..", "..", "scripts");

/**
 * Every script in `scripts/`, as `[name, contents]`.
 *
 * Not recursing is what leaves `lib/harness.sh` out — it is sourced rather
 * than run, and cannot be skipped.
 */
const shellScripts = (): [string, string][] =>
  readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".sh"))
    .map((name) => [name, readFileSync(join(SCRIPTS, name), "utf8")]);

describe("a skip that says why", () => {
  // The rule is `check.sh`'s: it reads the reason with
  // `sed -n 's/^ *SKIP: *//p'` over the script's output, so a reason printed
  // any other way is a reason the runner never shows. Under
  // `DOMICILE_CHECK_STRICT=1` that becomes `FAILED ()`, which is the empty
  // failure `check.sh`'s own comments say cost a session.
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
    // `check.sh` anchors the prefix to the start of a line, so prose that
    // merely contains the word satisfies a substring test and nothing else.
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
