import { useCallback, useEffect, useState } from "react";

import {
  ORDER_KEY,
  parseOrder,
  rememberedOrder,
  rememberOrder,
} from "./remembered-order";
import { moveTo } from "./tray-order";

export type TrayOrder = {
  /** The order the user put the tray in; see `arrange`. */
  order: readonly string[];
  /** Drag `dragged` onto `target`, among the `shown` keys; see `moveTo`. */
  move: (shown: readonly string[], dragged: string, target: string) => void;
};

/**
 * The order of the tray's icons, remembered on this machine.
 *
 * Held once for the page rather than once per bar, for `useExtensions`'
 * reason: a page that is the whole desktop draws a bar per monitor, and a drag
 * on one is a drag on all of them. A desk that is a page per monitor hears the
 * others' drags as `storage` events, which the browser sends every page of the
 * origin but the one that wrote.
 */
export const useTrayOrder = (): TrayOrder => {
  const [order, setOrder] = useState(rememberedOrder);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ORDER_KEY) {
        setOrder(parseOrder(event.newValue ?? "[]"));
      }
    };
    globalThis.addEventListener("storage", onStorage);
    return () => {
      globalThis.removeEventListener("storage", onStorage);
    };
  }, []);

  const move = useCallback(
    (shown: readonly string[], dragged: string, target: string) => {
      const next = moveTo(order, shown, dragged, target);
      setOrder(next);
      rememberOrder(next);
    },
    [order],
  );

  return { move, order };
};
