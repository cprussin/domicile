// Which letters of a row the query is responsible for.
//
// A filtered list answers "these ones" and leaves the user to work out why.
// Marking the letters that matched answers the second question in the same
// glance as the first — which is the whole of what a search field is for, and
// what makes a narrowing list legible rather than magic.
//
// The rule is `matching.ts`'s, read the other way round: every word of the
// query appears somewhere in the path, ignoring case, so every place any of
// them appears is a place the row earned.

/** A run of a row's text, and whether the query is what put it there. */
export type Mark = {
  matched: boolean;
  text: string;
};

/** `text` cut into the runs `query`'s words matched and the runs they did not. */
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

/** Where `word` sits in `lowered`, every time it sits there. */
type Run = { at: number; to: number };

const occurrences = (lowered: string, word: string): readonly Run[] => {
  const found: Run[] = [];
  // `indexOf` from the last hit rather than a global regexp, because a query
  // is somebody's typing: `a.b` and `c++` are words here, not patterns, and
  // escaping them to make them literal again is the longer way round.
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
 * The runs, with the ones that touch or overlap folded into one.
 *
 * Two words can cover the same letters — `note notes` is a query that matches
 * — and two runs meeting in the middle of a name would draw a seam nothing
 * put there.
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

/** `text` split at the edges of `runs`, each piece saying which side it is on. */
const cut = (text: string, runs: readonly Run[]): readonly Mark[] => {
  const pieces = runs.flatMap((run, index) => [
    { matched: false, text: text.slice(runs[index - 1]?.to ?? 0, run.at) },
    { matched: true, text: text.slice(run.at, run.to) },
  ]);
  const rest = { matched: false, text: text.slice(runs.at(-1)?.to ?? 0) };
  return [...pieces, rest].filter((piece) => piece.text !== "");
};
