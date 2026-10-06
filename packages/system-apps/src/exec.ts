// An `Exec` value read into argv, per the desktop entry spec.

import type { Option } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";

import { unescaped } from "./escapes";

/**
 * `exec` as argv, or nothing if it is malformed or empty.
 *
 * Unescapes strings, then quoting, in the spec's order. Drops field codes,
 * since a launcher passes no files, URLs or icon, along with any argument
 * that was only a field code.
 */
export const commandOf = (exec: string): Option<string[]> => {
  const words: string[] = [];
  let word = "";
  let quoted = false;
  // Whether the previous character was a `\` inside quotes, or a `%`.
  let escaping = false;
  let fieldCode = false;
  for (const char of unescaped(exec)) {
    if (escaping) {
      word += char;
      escaping = false;
    } else if (fieldCode) {
      word += char === "%" ? "%" : "";
      fieldCode = false;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "\\" && quoted) {
      escaping = true;
    } else if (char === "%") {
      fieldCode = true;
    } else if (char === " " && !quoted) {
      words.push(...(word === "" ? [] : [word]));
      word = "";
    } else {
      word += char;
    }
  }
  words.push(...(word === "" ? [] : [word]));
  return quoted || words.length === 0 ? None() : Some(words);
};
