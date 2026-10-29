import type { Notification } from "@domicile-desktop/sdk/notification";
import { useCallback, useState } from "react";

import type { Row } from "./drawer-rows";
import { nextRows } from "./drawer-rows";

/**
 * The drawer's rows for `items`, cleared ones kept until they have animated
 * out, and `onLeft` to drop one once it has. See `nextRows`.
 */
export const useDrawerRows = (
  items: readonly Notification[],
  animate: boolean,
): { rows: readonly Row[]; onLeft: (id: number) => void } => {
  const [drawn, setDrawn] = useState(() => ({
    animate,
    items,
    rows: nextRows([], items, false),
  }));
  // Worked out while rendering, not in an effect, so a cleared row never
  // blinks out for a frame before it starts leaving.
  const changed = drawn.items !== items || drawn.animate !== animate;
  const rows = changed ? nextRows(drawn.rows, items, animate) : drawn.rows;
  if (changed) {
    setDrawn({ animate, items, rows });
  }
  const onLeft = useCallback((id: number) => {
    setDrawn((current) => ({
      ...current,
      rows: current.rows.filter(({ notification }) => notification.id !== id),
    }));
  }, []);
  return { onLeft, rows };
};
