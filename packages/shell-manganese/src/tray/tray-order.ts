/**
 * `items` in the order the user put them in: those `order` remembers where it
 * has them, and the rest after, in the order they arrived.
 *
 * `order` may name items that are not here — an application that was closed,
 * an extension that was turned off. They take no place now and keep theirs for
 * when they come back.
 */
export const arrange = <T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  order: readonly string[],
): readonly T[] => {
  const placed = items.filter((item) => order.includes(keyOf(item)));
  const unplaced = items.filter((item) => !order.includes(keyOf(item)));
  return [
    ...placed.toSorted(
      (a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b)),
    ),
    ...unplaced,
  ];
};

/**
 * `order` with every one of the `shown` keys it had never placed placed after
 * the rest, as they arrived — so an icon comes back where it first appeared
 * rather than after whatever arrived while it was gone.
 */
export const place = (
  order: readonly string[],
  shown: readonly string[],
): readonly string[] => [
  ...order,
  ...shown.filter((key) => !order.includes(key)),
];

/**
 * `order` with `dragged` moved to where `target` is: after it when it was
 * dragged rightward, before it when leftward — so the item under the pointer
 * is always the one that makes way.
 *
 * `shown` is the keys on the bar, in the order they are drawn. Any of them the
 * order had never placed are placed first, where they are drawn, so the move
 * is a move among what the user sees. What is not shown keeps its place.
 */
export const moveTo = (
  order: readonly string[],
  shown: readonly string[],
  dragged: string,
  target: string,
): readonly string[] => {
  const full = place(order, shown);
  const rightward = full.indexOf(dragged) < full.indexOf(target);
  const without = full.filter((key) => key !== dragged);
  const at = without.indexOf(target) + (rightward ? 1 : 0);
  return [...without.slice(0, at), dragged, ...without.slice(at)];
};
