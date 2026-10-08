// An `Exec` value read into argv, per the desktop entry spec.

import type { Option } from "@cprussin/option-result";
import { None, Some } from "@cprussin/option-result";

import { unescaped } from "./escapes";

/** The field codes for files and URLs. A local file may stand for a URL. */
const FILE_CODES = new Set(["f", "F", "u", "U"]);

/**
 * `exec` as argv opening `file`, or nothing if it is malformed or empty.
 *
 * Unescapes strings, then quoting, in the spec's order. Puts `file` in place
 * of each file or URL field code, or after the last argument when there is
 * none. Drops every other field code, along with any argument that was only a
 * field code.
 */
export const commandOf = (exec: string, file?: string): Option<string[]> => {
  const words: string[] = [];
  let placed = false;
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
      word += expanded(char, file);
      placed ||= file !== undefined && FILE_CODES.has(char);
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
  words.push(...(file === undefined || placed ? [] : [file]));
  return quoted || words.length === 0 ? None() : Some(words);
};

/** What field code `code` stands for when opening `file`. */
const expanded = (code: string, file: string | undefined): string => {
  if (file !== undefined && FILE_CODES.has(code)) {
    return file;
  } else {
    return code === "%" ? "%" : "";
  }
};
