// A startup command as one line of text: an argv written and read with a
// shell's quoting, so an argument may hold spaces. No shell runs it.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

/** Characters that make an argument need quotes. */
const SPECIAL = /[\s"'\\]/;

/** `argv` as one line, each argument quoted only if it needs it. */
export const joinArgv = (argv: readonly string[]): string =>
  argv
    .map((arg) =>
      arg === "" || SPECIAL.test(arg)
        ? `"${arg.replaceAll(/["\\]/g, (found) => `\\${found}`)}"`
        : arg,
    )
    .join(" ");

/**
 * The argv `line` spells: words split on spaces, with `"…"`, `'…'` and `\`
 * quoting as in a shell.
 */
export const splitArgv = (line: string): Result<string[], string> => {
  const argv: string[] = [];
  let word: string | undefined;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      word = (word ?? "") + char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== undefined) {
      word = char === quote ? (word ?? "") : (word ?? "") + char;
      quote = char === quote ? undefined : quote;
    } else if (char === '"' || char === "'") {
      quote = char;
      word = word ?? "";
    } else if (/\s/.test(char)) {
      if (word !== undefined) {
        argv.push(word);
        word = undefined;
      }
    } else {
      word = (word ?? "") + char;
    }
  }
  if (word !== undefined) {
    argv.push(word);
  }
  if (quote !== undefined || escaped) {
    return Err("A quote is not closed");
  } else if (argv.length === 0) {
    return Err("A command needs a program");
  } else {
    return Ok(argv);
  }
};
