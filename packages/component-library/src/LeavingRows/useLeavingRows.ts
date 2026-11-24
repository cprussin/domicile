import { useCallback, useState } from "react";

import type { RowMotion } from "./LeavingRow";
import type { Row } from "./leaving-rows";
import { closedOver, nextRows, slidOut, withRises } from "./leaving-rows";

/** A row to draw, and how its `LeavingRow` moves. */
export type MovingRow<T> = Row<T> & { motion: RowMotion };

/**
 * A list's rows for `items`, removed ones kept until they have animated out,
 * each with the motion its `LeavingRow` takes. See `nextRows`.
 *
 * `onLeft` drops a row at once, for a list whose rows animate out on their
 * own, as dialogs do.
 */
export const useLeavingRows = <T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
  animate: boolean,
): { rows: readonly MovingRow<T>[]; onLeft: (key: K) => void } => {
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
  const onSlid = useCallback(
    (key: K, room: number) => {
      setDrawn((current) => ({
        ...current,
        rows: slidOut(current.rows, key, keyOf, room),
      }));
    },
    [keyOf],
  );
  const onClosed = useCallback(
    (key: K) => {
      setDrawn((current) => ({
        ...current,
        rows: closedOver(current.rows, key, keyOf),
      }));
    },
    [keyOf],
  );
  return {
    onLeft,
    rows: withRises(rows).map(({ rise, ...row }) => ({
      ...row,
      motion: {
        arriving: row.arriving,
        leaving: row.leaving,
        onClosed: () => {
          onClosed(keyOf(row.item));
        },
        onSlid: (room) => {
          onSlid(keyOf(row.item), room);
        },
        rise,
      },
    })),
  };
};
