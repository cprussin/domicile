// Which desktop file IDs a launcher leaves out, as globs.

/**
 * Whether a desktop file ID is left out, per `patterns`.
 *
 * Each pattern is a glob: `*` matches any run, `?` one character and `[…]`
 * one of a set. A pattern starting with `!` takes an ID back, and the last
 * matching pattern wins, so `["*", "!launcher-*"]` keeps only IDs starting
 * with `launcher-`. Throws on a pattern that is not a glob.
 */
export const omitting = (
  patterns: readonly string[],
): ((id: string) => boolean) => {
  const rules = patterns.map((pattern) => {
    const keeps = pattern.startsWith("!");
    return { glob: globOf(keeps ? pattern.slice(1) : pattern), keeps };
  });
  return (id) => {
    const last = rules.findLast(({ glob }) => glob.test(id));
    return last !== undefined && !last.keeps;
  };
};

/** `pattern` as an anchored regular expression. */
const globOf = (pattern: string): RegExp => {
  const parts = pattern.match(/\[[^\]]*\]|\*|\?|\[|[^*?[]+/g) ?? [];
  return new RegExp(
    `^${parts
      .map((part) => {
        switch (part) {
          case "*": {
            return ".*";
          }
          case "?": {
            return ".";
          }
          case "[": {
            throw new Error(
              `\`${pattern}\` is not a glob: \`[\` is not closed`,
            );
          }
          default: {
            // A `[…]` set reads the same as a regular expression's.
            return part.startsWith("[") ? part : RegExp.escape(part);
          }
        }
      })
      .join("")}$`,
    "s",
  );
};
