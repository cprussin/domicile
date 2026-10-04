/**
 * `items` in the user's order: those `order` places first, the rest after in
 * arrival order.
 *
 * `order` may name absent items, such as closed applications. They keep their
 * place for when they return.
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
 * `order` with any unplaced `shown` keys appended in arrival order, so an icon
 * returns where it first appeared.
 */
export const place = (
  order: readonly string[],
  shown: readonly string[],
): readonly string[] => [
  ...order,
  ...shown.filter((key) => !order.includes(key)),
];

/**
 * `order` with `dragged` moved to `target`'s place: after it when dragged
 * right, before it when dragged left, so the item under the pointer makes way.
 *
 * `shown` is the keys on the bar, in drawn order. Unplaced ones are placed
 * first, where they are drawn, so the move matches what the user sees. Hidden
 * keys keep their place.
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
