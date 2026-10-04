// Checks that every skip in `scripts/` prints a reason `check.sh` can read.
//
// `check.sh` reads the reason with `sed -n 's/^ *SKIP: *//p'`. A script that
// exits 77 without a `SKIP:` line reports an empty reason, which fails under
// `DOMICILE_CHECK_STRICT=1`.
//
// This is a text scan, not a shell parser, so the proximity window is
// approximate. `turbo.json` lists `scripts/**` as an input to `test:unit` so
// that a new script re-runs this check.

/** What a script exits with when a dependency it needs is not here. */
const SKIP_EXIT = /(^|;|\|\||&&|\s)exit\s+["']?77["']?(\s|;|$)/;

/** A line that is only a comment, which cannot exit anything. */
const REMARK = /^\s*#/;

/**
 * A statement that prints a line `check.sh` can read the reason from.
 *
 * `SKIP:` must open the printed string, so this matches command position, not
 * line position. That accepts `|| { echo "SKIP: …"; exit 77; }` and rejects
 * prose that only contains the word.
 */
const SKIP_LINE = /(^|[;{(]|&&|\|\|)\s*(echo\s+)?["']?\s*SKIP:/;

/**
 * How many lines above an `exit 77` its reason may be printed.
 *
 * A wider window would match the reason of an earlier branch.
 */
const WITHIN = 4;

/** Every `exit 77` in `script` without a readable reason, by line number. */
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
