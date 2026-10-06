// The launcher's matching rule, shared by applications and bookmarks so their
// rows agree.

/** How to match and order one kind of row. */
export type Ranking<T> = {
  /** The text every query word must appear in, in lower case. */
  words: (item: T) => string;
  name: (item: T) => string;
  /** Orders equal names, so the order does not depend on a listing's. */
  tieBreak: (item: T) => string;
};

/**
 * Up to `limit` of `items` matching `query`, best first.
 *
 * Every query word must appear, case-insensitively, in the item's words.
 * Names that start with the query rank first, then sort by name.
 */
export const ranked = <T>(
  items: readonly T[],
  query: string,
  limit: number,
  ranking: Ranking<T>,
): T[] => {
  const typed = query.trim().toLowerCase();
  const words = typed.split(/\s+/).filter((word) => word !== "");
  return items
    .filter((item) => {
      const text = ranking.words(item);
      return words.every((word) => text.includes(word));
    })
    .map((item) => {
      const name = ranking.name(item).toLowerCase();
      return {
        item,
        key: [
          name.startsWith(typed) ? 0 : 1,
          name,
          ranking.tieBreak(item),
        ] as const,
      };
    })
    .toSorted((a, b) => compared(a.key, b.key))
    .slice(0, limit)
    .map(({ item }) => item);
};

/** Compares keys element by element, strings by UTF-16 code unit. */
const compared = (
  a: readonly [number, string, string],
  b: readonly [number, string, string],
): number => a[0] - b[0] || byCodeUnit(a[1], b[1]) || byCodeUnit(a[2], b[2]);

const byCodeUnit = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  } else {
    return a > b ? 1 : 0;
  }
};
