// Checking rows, with Shift extending from the last row checked.

/** A click on a row's check box, with the row Shift extends from. */
export type Toggle = { id: string; anchor?: string | undefined };

/**
 * The selection after toggling `id`. With an `anchor` still in `order`, every
 * row from the anchor to `id` takes the state `id` turns to.
 */
export const toggleSelection = (
  selected: ReadonlySet<string>,
  order: readonly string[],
  { anchor, id }: Toggle,
): Set<string> => {
  const on = !selected.has(id);
  const range = span(order, anchor, id);
  return on ? selected.union(range) : selected.difference(range);
};

/** The ids from `anchor` to `id` in `order`, or just `id`. */
const span = (
  order: readonly string[],
  anchor: string | undefined,
  id: string,
): Set<string> => {
  const from = anchor === undefined ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  return from === -1
    ? new Set([id])
    : new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1));
};
