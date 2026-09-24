// Which of the offered files a query is still asking about.
//
// `fzf --exact` is what the launcher this one is modeled on filters with, and
// this is what that means: every word has to appear somewhere in the path, in
// any order, ignoring case. No ranking and no reordering — the host already
// sorted, and a second rule about order would be a second chance for the list
// to jump around under a keystroke that only narrowed it.
//
// THE FOLDING IS THE OTHER HALF, and it is why this takes `Folded` rather than
// the paths the host answered with. The list used to be a few hundred rows; it
// is an index of the whole home now, and on 120,000 paths the two halves of
// this file measure very differently: folding them to lower case is 28 ms and
// scanning the folded ones is 5. Folding per keystroke is a launcher that
// drops a frame of the desktop behind it on every letter; folding per list is
// once, while the panel opens.

/** An offered path, beside the form the filter compares against. */
export type Folded = {
  /** What a row draws and what Enter opens. */
  path: string;
  /** `path` in lower case, which is the only form this module reads. */
  lowered: string;
};

/** The offered paths in the form the filter reads them, worked out once. */
export const folded = (offered: readonly string[]): readonly Folded[] =>
  offered.map((path) => ({ lowered: path.toLowerCase(), path }));

/** The rows of `offered` that `query` is still asking about, in the order given. */
export const matching = (
  offered: readonly Folded[],
  query: string,
): readonly string[] => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  return offered
    .filter(({ lowered }) => words.every((word) => lowered.includes(word)))
    .map(({ path }) => path);
};
