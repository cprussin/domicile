// Whether a check that did not run can say so, and can be reached at all.
//
// Two rules about `scripts/`, both about a check being *legible* rather than
// about what it asserts. Each was a real defect before it was a rule.
//
// **A skip needs a reason, in the one shape that survives.** `check.sh` reads
// the reason out of the script's own output with `sed -n 's/^ *SKIP: *//p'`,
// so a script that exits 77 after printing prose without that prefix reports
// `skipped ()` — and under `DOMICILE_CHECK_STRICT=1`, `FAILED ()` with an
// empty reason in the failures file. `check.sh` says in its own comments what
// an empty reason cost once; three scripts were spelling it that way.
//
// **A check nothing can run is not a check.** `nix run .#<name>` is how a
// check runs against a revision with no clone and no toolchain, and ten
// `e2e-*.sh` had no app — not by decision, but because the list in `flake.nix`
// stopped being updated alongside the directory. A roster goes stale silently;
// a rule does not.
//
// Both are spellings, which is the one thing a text scan can honestly police —
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

/**
 * The `scripts/<name>.sh` each `nix run .#<attr>` reaches, from `flake.nix`.
 *
 * Read out of the `scriptApps` attrset rather than by evaluating the flake:
 * `nix eval` needs nix, a network and a store, and this is a rule about what
 * the file says.
 */
const appScripts = (flake: string): Set<string> =>
  new Set(
    [...flake.matchAll(/^\s*[a-z0-9-]+\s*=\s*"([a-z0-9-]+\.sh)";/gm)].map(
      (match) => match[1] ?? "",
    ),
  );

/**
 * Every end-to-end script `nix run` cannot reach.
 *
 * `e2e-*.sh` only. The `test-xvfb-*` checks run in `check.sh`'s shell group
 * and have never had apps, and `lib/` is not a check — naming the ones that
 * *should* have one is the roster this rule exists to replace, so the glob is
 * the roster.
 */
export const unreachableChecks = (
  flake: string,
  scripts: string[],
): string[] => {
  const apps = appScripts(flake);
  return scripts
    .filter((name) => name.startsWith("e2e-") && !apps.has(name))
    .map((name) => `${name} has no flake app, so nix run cannot reach it`);
};
