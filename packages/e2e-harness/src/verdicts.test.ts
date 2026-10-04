import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bailFaults } from "./verdicts";

/** Where the e2e scripts live, from this file. */
const SCRIPTS = join(import.meta.dir, "..", "..", "..", "scripts");

/** The sourced helper the scripts bail through. */
const HARNESS = join(SCRIPTS, "lib", "harness.sh");

/**
 * Runs `harness_fault` against `pid` and reports what the shell saw.
 *
 * Runs the real file, because a text scan cannot tell whether the bail
 * re-checks the compositor.
 */
const bail = (pid: string): { status: number; out: string } => {
  const run = spawnSync(
    "bash",
    ["-c", `. "${HARNESS}"; harness_fault "${pid}" "it did the thing" "why"`],
    { encoding: "utf8" },
  );
  return { out: run.stdout, status: run.status ?? -1 };
};

/** Runs `compositor_verdict` against `pid` and reports what the shell saw. */
const verdict = (pid: string): { status: number; out: string } => {
  const run = spawnSync(
    "bash",
    ["-c", `. "${HARNESS}"; compositor_verdict "${pid}" "why"`],
    { encoding: "utf8" },
  );
  return { out: run.stdout, status: run.status ?? -1 };
};

/**
 * Every script in `scripts/`, as `[name, contents]`.
 *
 * Includes `test-*.sh`, since any script can drive a compositor. Does not
 * recurse, which leaves out `lib/harness.sh` itself.
 */
const shellScripts = (): [string, string][] =>
  readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".sh"))
    .map((name) => [name, readFileSync(join(SCRIPTS, name), "utf8")]);

describe("harness_fault", () => {
  it("blames the compositor when the compositor is gone", () => {
    // A pid past `pid_max`: a recently exited pid could be reused by the
    // kernel.
    const { out, status } = bail("2147483647");
    expect(status).toBe(1);
    expect(out).toContain("the compositor exited before it did the thing");
    expect(out).toContain("Not this script's harness");
    // The caller's diagnosis assumes a live compositor, so it is omitted.
    expect(out).not.toContain("why");
  });

  it("blames itself when the compositor is fine", () => {
    const { out, status } = bail(String(process.pid));
    expect(status).toBe(99);
    expect(out).toContain("why");
    expect(out).toContain("That is this script's harness");
  });
});

describe("compositor_verdict", () => {
  it("says the compositor is gone rather than repeating the diagnosis", () => {
    // Still a compositor failure (status 1), but the caller's diagnosis no
    // longer applies.
    const { out, status } = verdict("2147483647");
    expect(status).toBe(1);
    expect(out).toContain("the compositor exited");
    expect(out).not.toContain("why");
  });

  it("gives the caller's diagnosis when the compositor is alive", () => {
    const { out, status } = verdict(String(process.pid));
    expect(status).toBe(1);
    expect(out).toContain("why");
  });
});

describe("a helper handed no pid", () => {
  // `kill -0 ""` fails, so an empty pid would look like a dead compositor and
  // blame the code for a script bug.
  it("blames the script, from either helper", () => {
    for (const { out, status } of [bail(""), verdict("")]) {
      expect(status).toBe(99);
      expect(out).toContain("no compositor pid was passed");
      expect(out).not.toContain("why");
    }
  });
});

describe("after, passed and every_check_ran", () => {
  /** Runs a snippet against the real helper file and reports what bash saw. */
  const run = (body: string): { status: number; out: string } => {
    const done = spawnSync("bash", ["-c", `set -u; . "${HARNESS}"; ${body}`], {
      encoding: "utf8",
    });
    return { out: done.stdout, status: done.status ?? -1 };
  };

  it("counts a decision that reached a verdict", () => {
    const { out, status } = run(
      'passed "one"; passed "two"; every_check_ran 2',
    );
    expect(status).toBe(0);
    expect(out).toContain("PASS: one");
    expect(out).toContain("PASS: two");
  });

  it("fails the run when a decision was skipped", () => {
    // A bail that does nothing leaves a decision undecided. Without the count
    // the script would exit green.
    const { out, status } = run('passed "one"; every_check_ran 2');
    expect(status).toBe(1);
    expect(out).toContain("1 of 2 checks reached a verdict");
    expect(out).toContain("skipped");
  });

  it("says which way the count drifted", () => {
    const { out, status } = run('passed "a"; passed "b"; every_check_ran 1');
    expect(status).toBe(1);
    expect(out).toContain("More decisions passed than this script has");
  });

  it("holds a decision to the ones before it", () => {
    expect(run("after 0 && echo yes").out).toContain("yes");
    expect(run('passed "one"; after 1 && echo yes').out).toContain("yes");
  });

  it("reports both numbers itself when the premise does not hold", () => {
    // So callers do not repeat the count and let it drift.
    const { out } = run('after 2 || echo "bailed"');
    expect(out).toContain("2 checks should have passed before this one; 0 did");
    expect(out).toContain("bailed");
  });
});

describe("bailFaults", () => {
  it("reports a bare exit 99 by line", () => {
    expect(
      bailFaults(
        [
          '. "$ROOT/scripts/lib/harness.sh"',
          'if [ -z "$X" ]; then',
          "  exit 99",
          "fi",
        ].join("\n"),
      ),
    ).toStrictEqual([
      "3: exits 99 without a helper from scripts/lib/harness.sh",
    ]);
  });

  it("finds one however the line is written", () => {
    expect(
      bailFaults(["grep -q ready log || exit 99"].join("\n")),
    ).toHaveLength(1);
    expect(
      bailFaults(['if [ -z "$X" ]; then exit 99; fi'].join("\n")),
    ).toHaveLength(1);
  });

  it("is not fooled by a longer number or a comment", () => {
    expect(bailFaults(["exit 991"].join("\n"))).toStrictEqual([]);
    expect(
      bailFaults(["# exit 99 means the harness failed"].join("\n")),
    ).toStrictEqual([]);
  });

  it("finds an exit 99 a person would actually write", () => {
    // Not exhaustive: `rc=99; exit $rc` is missed, which is why scripts also
    // count their verdicts.
    expect(bailFaults(['exit "99"'].join("\n"))).toHaveLength(1);
    expect(bailFaults(["exit $((99))"].join("\n"))).toHaveLength(1);
  });

  it("reports a definition written in bash's other function syntax", () => {
    // `function harness_fault {` has no parens. Defined after the source
    // line, it shadows the real helper.
    expect(
      bailFaults(
        [
          '. "$ROOT/scripts/lib/harness.sh"',
          "function harness_fault {",
          '  exit "99"',
          "}",
        ].join("\n"),
      ),
    ).toContain("defines its own harness_fault");
  });

  it("is not satisfied by a source line that does not source", () => {
    // Each names the helper's path without sourcing it. A substring rule
    // would accept the shellcheck directive alone.
    for (const script of [
      '# shellcheck source=scripts/lib/harness.sh\nharness_fault "$COMP" "x"',
      '# . "$ROOT/scripts/lib/harness.sh"\nharness_fault "$COMP" "x"',
      'echo "see scripts/lib/harness.sh"\nharness_fault "$COMP" "x"',
    ]) {
      expect(bailFaults(script)).toContain(
        "calls harness_fault without sourcing scripts/lib/harness.sh",
      );
    }
  });

  it("reports a subshell-body definition, which is worse than a copy", () => {
    // The `exit` inside `harness_fault() ( ... )` ends only the subshell, so
    // the bail does nothing.
    expect(
      bailFaults(
        [
          '. "$ROOT/scripts/lib/harness.sh"',
          "harness_fault() (",
          "  exit 99",
          ")",
        ].join("\n"),
      ),
    ).toContain("defines its own harness_fault");
  });

  it("holds compositor_verdict to the same rules as harness_fault", () => {
    // Bypassing either helper hides a compositor crash.
    expect(
      bailFaults(['compositor_verdict "$COMP" "FAIL: it did not"'].join("\n")),
    ).toStrictEqual([
      "calls compositor_verdict without sourcing scripts/lib/harness.sh",
    ]);
    expect(
      bailFaults(
        [
          '. "$ROOT/scripts/lib/harness.sh"',
          "compositor_verdict() {",
          "  exit 1",
          "}",
        ].join("\n"),
      ),
    ).toContain("defines its own compositor_verdict");
  });

  it("reports a script that spells the bail out for itself", () => {
    // The behavior test does not cover a copy, and a scan cannot tell whether
    // the copy re-checks the compositor.
    expect(
      bailFaults(["harness_fault () {", "  exit 99", "}"].join("\n")),
    ).toContain("defines its own harness_fault");
  });

  it("reads a call wherever a command can start", () => {
    // Otherwise a script that calls a helper only in these forms, without the
    // source line, would go unreported.
    for (const script of [
      'if [ -z "$X" ]; then harness_fault "$COMP" "x"; fi',
      'for i in 1; do harness_fault "$COMP" "x"; done',
      'grep -q x log || { harness_fault "$COMP" "x"; }',
      'fail() { compositor_verdict "$COMP" "FAIL: $1"; }',
    ]) {
      expect(bailFaults(script)).toHaveLength(1);
    }
  });

  it("does not read prose or a quoted regex as a call", () => {
    // `after` and `passed` are common words in script comments, and a lone `|`
    // is usually inside a pattern.
    expect(bailFaults('grep -E "before|after" log')).toStrictEqual([]);
    expect(
      bailFaults("# a bail that no-ops, if passed is not reached"),
    ).toStrictEqual([]);
  });

  it("reports a script that calls the bail it cannot reach", () => {
    // `set -e` is off, so the missing helper does nothing and the verdict
    // below blames the compositor.
    expect(
      bailFaults(['harness_fault "$COMP" "it worked"'].join("\n")),
    ).toStrictEqual([
      "calls harness_fault without sourcing scripts/lib/harness.sh",
    ]);
  });

  it("passes a script that sources the helper and bails through it", () => {
    expect(
      bailFaults(
        [
          '. "$ROOT/scripts/lib/harness.sh"',
          'if [ -z "$X" ]; then',
          '  harness_fault "$COMP" "it worked" "ERROR: it did not"',
          "fi",
        ].join("\n"),
      ),
    ).toStrictEqual([]);
  });
});

describe("every script that can tell a dead compositor apart", () => {
  // Read once so the next test can fail an empty scan.
  const scripts = shellScripts();

  it("scans the scripts", () => {
    // Any two existing scripts will do. If one is deleted, pick another.
    expect(scripts.map(([name]) => name)).toContain("test-annotate.sh");
    expect(scripts.map(([name]) => name)).toContain(
      "test-css-and-resize-verdict.sh",
    );
  });

  it("routes every harness bail through the liveness check", () => {
    expect(
      scripts.flatMap(([name, text]) =>
        bailFaults(text).map((fault) => `${name}:${fault}`),
      ),
    ).toStrictEqual([]);
  });
});
