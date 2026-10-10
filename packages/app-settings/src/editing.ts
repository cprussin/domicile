// The code editor's keys: Tab, Shift+Tab and Enter, as edits of the text and
// its selection.

/** Text with a selection from `start` to `end`; equal for a cursor. */
export type Edit = { end: number; start: number; text: string };

/** What one level of indentation is. */
const INDENT = "  ";

/** Tab: two spaces at a cursor, or before every line a selection touches. */
export const indent = ({ end, start, text }: Edit): Edit => {
  if (start === end) {
    return {
      end: start + INDENT.length,
      start: start + INDENT.length,
      text: text.slice(0, start) + INDENT + text.slice(end),
    };
  } else {
    const starts = lineStarts(text, start, end);
    return {
      end: end + INDENT.length * starts.length,
      start: start + INDENT.length,
      text: starts.reduceRight(
        (edited, at) => edited.slice(0, at) + INDENT + edited.slice(at),
        text,
      ),
    };
  }
};

/** Shift+Tab: up to two spaces off every line the selection touches. */
export const outdent = ({ end, start, text }: Edit): Edit => {
  const starts = lineStarts(text, start, end);
  const removed = starts.map(
    (at) => text.slice(at, at + INDENT.length).match(/^ */)?.[0].length ?? 0,
  );
  const first = starts[0] ?? 0;
  const last = starts.at(-1) ?? 0;
  const before = removed.slice(0, -1).reduce((sum, count) => sum + count, 0);
  return {
    end: end - before - Math.min(removed.at(-1) ?? 0, end - last),
    start: Math.max(first, start - (removed[0] ?? 0)),
    text: starts.reduceRight(
      (edited, at, index) =>
        edited.slice(0, at) + edited.slice(at + (removed[index] ?? 0)),
      text,
    ),
  };
};

/** Enter: a new line, indented as the line it breaks. */
export const newline = ({ end, start, text }: Edit): Edit => {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const indentation = text.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "";
  const inserted = `\n${indentation.slice(0, start - lineStart)}`;
  return {
    end: start + inserted.length,
    start: start + inserted.length,
    text: text.slice(0, start) + inserted + text.slice(end),
  };
};

/** Where each line from the one holding `start` to the one holding `end` begins. */
const lineStarts = (text: string, start: number, end: number): number[] => {
  const first = text.lastIndexOf("\n", start - 1) + 1;
  const breaks = [...text.slice(first, end).matchAll(/\n/g)].map(
    (found) => first + found.index + 1,
  );
  return [first, ...breaks];
};
