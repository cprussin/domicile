// JSDoc comments for generated TypeScript.

/** A JSDoc comment, indented, or nothing for no lines. */
export const jsDoc = (lines: readonly string[], indent: string): string => {
  const escaped = lines.map((line) => line.replaceAll("*/", "*\\/"));
  const [only] = escaped;
  if (only === undefined) {
    return "";
  } else if (escaped.length === 1) {
    return `${indent}/** ${only} */\n`;
  } else {
    return `${indent}/**\n${escaped.map((line) => `${indent} * ${line}`.trimEnd()).join("\n")}\n${indent} */\n`;
  }
};
