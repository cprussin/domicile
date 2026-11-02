import { useCallback, useState } from "react";

import type { Row } from "./leaving-rows";
import { nextRows } from "./leaving-rows";

/**
 * A list's rows for `items`, removed ones kept until they have animated out,
 * and `onLeft` to drop one once it has. See `nextRows`.
 */
export const useLeavingRows = <T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
  animate: boolean,
): { rows: readonly Row<T>[]; onLeft: (key: K) => void } => {
  const [drawn, setDrawn] = useState(() => ({
    animate,
    items,
    rows: nextRows([], items, keyOf, false),
  }));
  // Worked out while rendering, not in an effect, so a removed row never
  // blinks out for a frame before it starts leaving.
  const changed = drawn.items !== items || drawn.animate !== animate;
  const rows = changed
    ? nextRows(drawn.rows, items, keyOf, animate)
    : drawn.rows;
  if (changed) {
    setDrawn({ animate, items, rows });
  }
  const onLeft = useCallback(
    (key: K) => {
      setDrawn((current) => ({
        ...current,
        rows: current.rows.filter(({ item }) => keyOf(item) !== key),
      }));
    },
    [keyOf],
  );
  return { onLeft, rows };
};
