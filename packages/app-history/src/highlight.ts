// Marks the words of a search in a row's title.

/** A run of text, and whether it matches the search. */
export type Segment = { marked: boolean; text: string };

/** `text` split into runs that match a word of `search` and runs that don't. */
export const highlight = (text: string, search: string): Segment[] => {
  const words = search.split(/\s+/u).filter((word) => word !== "");
  return words.length === 0
    ? [{ marked: false, text }]
    : text
        .split(new RegExp(`(${words.map(literal).join("|")})`, "iu"))
        // A split on a capture alternates the text between matches with the
        // matches, starting with the text before the first.
        .map((part, index) => ({ marked: index % 2 === 1, text: part }))
        .filter((segment) => segment.text !== "");
};

/** `word` as a pattern that matches it as it is. */
const literal = (word: string): string =>
  word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
