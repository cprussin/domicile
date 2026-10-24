// Checks that every skip in a check prints a reason `check-runner` can read.
//
// `check-runner` reads the reason with `sed -n 's/^ *SKIP: *//p'`, and fails a
// skip with none. This scan also covers the skips a run never reaches.
//
// This is a text scan, not a shell parser, so the proximity window is
// approximate. This package's `turbo.json` lists the checks as inputs to
// `test:unit`, so a new check re-runs this.

/** What a script exits with when a dependency it needs is not here. */
const SKIP_EXIT = /(^|;|\|\||&&|\s)exit\s+["']?77["']?(\s|;|$)/;

/** A line that is only a comment, which cannot exit anything. */
const REMARK = /^\s*#/;

/**
 * A statement that prints a line `check-runner` can read the reason from.
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
      : [
          `${index + 1}: exits 77 without a SKIP: line for check-runner to read`,
        ];
  });
};
