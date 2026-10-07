// Shell-style globs, as the XDG specs use them.

/**
 * `pattern` as an anchored regular expression: `*` matches any run, `?` one
 * character and `[…]` one of a set. Throws on a pattern that is not a glob.
 */
export const globOf = (pattern: string): RegExp => {
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
