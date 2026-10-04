// Marks the letters of a row that match the query, so users see why it matched.
//
// Mirrors the host's search (see `domicile_host::file_search`): every query
// word appears in the path, ignoring case. Every occurrence of any word is
// marked.

/** A run of a row's text, and whether it matched the query. */
export type Mark = {
  matched: boolean;
  text: string;
};

/** Split `text` into matched and unmatched runs for `query`. */
export const marked = (text: string, query: string): readonly Mark[] => {
  const lowered = text.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  const runs = merged(
    words
      .flatMap((word) => occurrences(lowered, word))
      .sort((one, other) => one.at - other.at),
  );
  return cut(text, runs);
};

/** A matched span of a row's text. */
type Run = { at: number; to: number };

const occurrences = (lowered: string, word: string): readonly Run[] => {
  const found: Run[] = [];
  // `indexOf` rather than a regexp, so `a.b` and `c++` match literally
  // without escaping.
  for (
    let at = lowered.indexOf(word);
    at !== -1;
    at = lowered.indexOf(word, at + 1)
  ) {
    found.push({ at, to: at + word.length });
  }
  return found;
};

/**
 * Merge touching or overlapping runs.
 *
 * Words can overlap (`note notes`), and unmerged runs would show a seam.
 */
const merged = (runs: readonly Run[]): readonly Run[] =>
  runs.reduce<Run[]>((folded, run) => {
    const last = folded.at(-1);
    if (last !== undefined && run.at <= last.to) {
      return [
        ...folded.slice(0, -1),
        { at: last.at, to: Math.max(last.to, run.to) },
      ];
    } else {
      return [...folded, run];
    }
  }, []);

/** Split `text` at the edges of `runs` into marked pieces. */
const cut = (text: string, runs: readonly Run[]): readonly Mark[] => {
  const pieces = runs.flatMap((run, index) => [
    { matched: false, text: text.slice(runs[index - 1]?.to ?? 0, run.at) },
    { matched: true, text: text.slice(run.at, run.to) },
  ]);
  const rest = { matched: false, text: text.slice(runs.at(-1)?.to ?? 0) };
  return [...pieces, rest].filter((piece) => piece.text !== "");
};
