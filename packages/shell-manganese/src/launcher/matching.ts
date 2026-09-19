// Which of the offered files a query is still asking about.
//
// `fzf --exact` is what the launcher this one is modelled on filters with, and
// this is what that means: every word has to appear somewhere in the path, in
// any order, ignoring case. No ranking and no reordering — the host already
// sorted, and a second rule about order would be a second chance for the list
// to jump around under a keystroke that only narrowed it.

/** The rows of `offered` that `query` is still asking about, in the order given. */
export const matching = (
  offered: readonly string[],
  query: string,
): readonly string[] => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
  return offered.filter((path) => {
    const lowered = path.toLowerCase();
    return words.every((word) => lowered.includes(word));
  });
};
