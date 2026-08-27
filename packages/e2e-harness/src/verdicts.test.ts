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
 * Drives the real file rather than reasoning about its text: whether the bail
 * re-checks the compositor is a behaviour, and the previous version of this
 * module tried to police it by reading and could be defeated by a rename.
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
 * All of them, not the `e2e-*.sh` ones: `check.sh` runs the `test-*.sh`
 * checks in the same loop and says why, and `measure*.sh` and
 * `probe-transparency.sh` drive the same harnesses. Reading the directory
 * without recursing is also what leaves `lib/harness.sh` out, which is the
 * one file the rules below are about rather than applied to.
 */
const shellScripts = (): [string, string][] =>
  readdirSync(SCRIPTS)
    .filter((name) => name.endsWith(".sh"))
    .map((name) => [name, readFileSync(join(SCRIPTS, name), "utf8")]);

describe("harness_fault", () => {
  it("blames the compositor when the compositor is gone", () => {
    // The failure this whole mechanism exists for. A pid past `pid_max`
    // rather than one recently exited, which the kernel is free to hand
    // straight back to the next process this test starts.
    const { out, status } = bail("2147483647");
    expect(status).toBe(1);
    expect(out).toContain("the compositor exited before it did the thing");
    // Says so in as many words, because the whole point is that the reader
    // does not go looking at this suite.
    expect(out).toContain("Not this script's harness");
    // And none of the caller's own diagnosis, which is about a machine that
    // was working when the message was written.
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
    // The mutant this exists for aborts the process, and "it never logged the
    // refusal" is a poor way to say "it is not running". A verdict either
    // way — the compositor is what failed — so the status stays 1 and only
    // the reason changes.
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
  // `kill -0 ""` fails, so an empty pid would read as a compositor that is
  // gone — this suite's own bookkeeping reported as the loudest possible
  // verdict on the code, which is the one thing this file exists to prevent.
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
    // The whole point: a bail that no-ops leaves its decision undecided, and
    // without this the script reaches the end and exits green.
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
    // So no caller spells the count a second time and gets them out of step.
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
    // Quoted and arithmetic forms both really exit 99. Not exhaustive and
    // cannot be — `rc=99; exit $rc` is two lines — which is why the scripts
    // count their own verdicts and check the count at the end.
    expect(bailFaults(['exit "99"'].join("\n"))).toHaveLength(1);
    expect(bailFaults(["exit $((99))"].join("\n"))).toHaveLength(1);
  });

  it("reports a definition written in bash's other function syntax", () => {
    // `function harness_fault {` has no parens. Six lines of it after the
    // source line shadow the sourced helper for every call below, and the
    // copy is free to leave the liveness check out.
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
    // Each of these names the helper's path and reaches none of it. The
    // shellcheck directive is the sharp one: it belongs directly above a real
    // source line, so a substring rule makes it a licence to delete that line.
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
    // `harness_fault() ( ... )` evades a `{`-only rule, and the `exit` inside
    // it ends the subshell rather than the script — a bail that no-ops without
    // anything being unsourced.
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
    // It was outside all three: a script whose only ending is this one fails
    // exactly as a script whose only ending is the other does.
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
    // A copy is a copy the behaviour test does not drive, and a scan cannot
    // tell one that re-checks the compositor from one that does not. The
    // helper says so itself; nothing enforced it until this.
    expect(
      bailFaults(["harness_fault () {", "  exit 99", "}"].join("\n")),
    ).toContain("defines its own harness_fault");
  });

  it("reads a call wherever a command can start", () => {
    // Not just at the start of a line. The wrapper form is `e2e-hidpi.sh`'s
    // own, and a fourth script whose only reach into the helpers is one of
    // these and which forgot the source line would otherwise be invisible.
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
    // `after` and `passed` are ordinary English, so the words appear in the
    // comments of a dozen scripts that have nothing to do with this — and a
    // lone `|` is nearly always inside a pattern rather than a pipe.
    expect(bailFaults('grep -E "before|after" log')).toStrictEqual([]);
    expect(
      bailFaults("# a bail that no-ops, if passed is not reached"),
    ).toStrictEqual([]);
  });

  it("reports a script that calls the bail it cannot reach", () => {
    // The worst failure of the three and the quietest: `set -e` is off, so a
    // missing source makes the call a no-op, the `if` body completes, and the
    // verdict below it blames the compositor for a harness fault.
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
  // Read once and asserted on, so a scan that found nothing — the scripts
  // renamed, moved, or this file's idea of where they live gone stale — fails
  // instead of reporting an empty list of offenders as success.
  const scripts = shellScripts();

  it("scans the scripts", () => {
    // Named because an empty scan must fail rather than report no offenders.
    // `e2e-electron.sh` rather than one of the mock-chrome checks: those are
    // being ported to Rust a batch at a time, and this canary named one of
    // them until the batch that deleted it. A check needing a real Electron
    // outlives that migration.
    expect(scripts.map(([name]) => name)).toContain("e2e-electron.sh");
    expect(scripts.map(([name]) => name)).toContain("test-xvfb-verdict.sh");
  });

  it("routes every harness bail through the liveness check", () => {
    expect(
      scripts.flatMap(([name, text]) =>
        bailFaults(text).map((fault) => `${name}:${fault}`),
      ),
    ).toStrictEqual([]);
  });
});
