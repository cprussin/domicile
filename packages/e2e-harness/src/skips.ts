// Whether a check that did not run can say so.
//
// One rule about `scripts/`, about a check being *legible* rather than about
// what it asserts, and it was a real defect before it was a rule.
//
// **A skip needs a reason, in the one shape that survives.** `check.sh` reads
// the reason out of the script's own output with `sed -n 's/^ *SKIP: *//p'`,
// so a script that exits 77 after printing prose without that prefix reports
// `skipped ()` — and under `DOMICILE_CHECK_STRICT=1`, `FAILED ()` with an
// empty reason in the failures file. `check.sh` says in its own comments what
// an empty reason cost once; three scripts were spelling it that way.
//
// A second rule lived here — that every `e2e-*.sh` had a `nix run .#<name>`
// app and that no app named a deleted script. Both went with the apps
// themselves: nothing ran them, and a roster nobody consults does not need
// policing.
//
// It is a spelling, which is the one thing a text scan can honestly police —
// see `verdicts.ts`'s header for why this file does not try to reason about
// shell control flow. The proximity window below is the approximation: a
// `SKIP:` five lines above an `exit 77` might belong to a different branch.
// What carries the weight is that a script has one skip shape and uses it.
//
// `turbo.json` puts `scripts/**` in `test:unit`'s inputs, so adding a script
// re-runs this rather than leaving it green against the set that existed when
// it was written.

/** What a script exits with when a dependency it needs is not here. */
const SKIP_EXIT = /(^|;|\|\||&&|\s)exit\s+["']?77["']?(\s|;|$)/;

/** A line that is only a comment, which cannot exit anything. */
const REMARK = /^\s*#/;

/**
 * A statement that prints a line `check.sh` can read the reason out of.
 *
 * `check.sh` anchors the prefix to the start of an output line, so what has to
 * be true of the *source* is that `SKIP:` opens the printed string. That is
 * command position, not line position: `|| { echo "SKIP: …"; exit 77; }` is
 * the shape half these scripts use, and a line-anchored rule rejects it while
 * accepting prose that merely contains the word.
 */
const SKIP_LINE = /(^|[;{(]|&&|\|\|)\s*(echo\s+)?["']?\s*SKIP:/;

/**
 * How far above an `exit 77` its reason may be printed.
 *
 * Four lines covers `echo …` immediately above, a `{ echo …; exit 77; }` block
 * split across lines, and a heredoc-free two-line message. Wider would start
 * matching a previous branch's reason.
 */
const WITHIN = 4;

/**
 * Every `exit 77` in `script` that prints no reason `check.sh` can read.
 *
 * Empty means every skip in it says why. The strings name the file's own line
 * numbers, because they are what a failing test prints.
 */
export const skipFaults = (script: string): string[] => {
  const lines = script.split("\n");
  return lines.flatMap((line, index) => {
    if (!SKIP_EXIT.test(line) || REMARK.test(line)) {
      return [];
    }
    const from = Math.max(0, index - WITHIN);
    const near = lines.slice(from, index + 1);
    return near.some((candidate) => SKIP_LINE.test(candidate))
      ? []
      : [`${index + 1}: exits 77 without a SKIP: line for check.sh to read`];
  });
};
