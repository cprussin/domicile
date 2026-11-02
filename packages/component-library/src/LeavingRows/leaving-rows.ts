// Which rows a list draws as its items come and go, so a removed one can
// animate out where it was. See `LeavingRow`.

/** An item drawn in a list. */
export type Row<T> = {
  item: T;
  /** It came in while the list showed, so it animates in. */
  arriving: boolean;
  /**
   * While it animates out, its place among the rows removed with it, top to
   * bottom, which staggers them.
   */
  leaving: number | undefined;
};

/**
 * The rows to draw for `items`, given the rows drawn before. `keyOf` tells
 * one item from another.
 *
 * An item gone from `items` stays under the row above it, leaving, until its
 * animation ends. One back in `items` stays. An item not drawn before arrives.
 * Without `animate`, such as while the list is hidden, gone items go at once
 * and none arrive.
 */
export const nextRows = <T, K>(
  rows: readonly Row<T>[],
  items: readonly T[],
  keyOf: (item: T) => K,
  animate: boolean,
): Row<T>[] => {
  const kept = new Set(items.map(keyOf));
  const drawn = new Set(rows.map(({ item }) => keyOf(item)));
  const gone = animate ? rows.filter(({ item }) => !kept.has(keyOf(item))) : [];
  const starting = gone.filter(({ leaving }) => leaving === undefined);
  const under = leavingUnder(rows, kept, keyOf, gone, starting);
  return [
    ...(under.get(undefined) ?? []),
    ...items.flatMap((item) => [
      {
        arriving: animate && !drawn.has(keyOf(item)),
        item,
        leaving: undefined,
      },
      ...(under.get(keyOf(item)) ?? []),
    ]),
  ];
};

/**
 * The leaving rows by the key of the staying row above each, `undefined` for
 * those above every staying row.
 */
const leavingUnder = <T, K>(
  rows: readonly Row<T>[],
  kept: ReadonlySet<K>,
  keyOf: (item: T) => K,
  gone: readonly Row<T>[],
  starting: readonly Row<T>[],
): Map<K | undefined, Row<T>[]> => {
  const under = new Map<K | undefined, Row<T>[]>();
  let above: K | undefined;
  for (const row of rows) {
    if (kept.has(keyOf(row.item))) {
      above = keyOf(row.item);
    } else if (gone.includes(row)) {
      under.set(above, [
        ...(under.get(above) ?? []),
        {
          arriving: false,
          item: row.item,
          leaving: row.leaving ?? starting.indexOf(row),
        },
      ]);
    }
  }
  return under;
};
