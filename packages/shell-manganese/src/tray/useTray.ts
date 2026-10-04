import type {
  DomicileHost,
  DomicileTrayItem,
} from "@domicile-desktop/sdk/domicile-host";
import { useEffect, useState } from "react";

import { watchHost } from "../host/watch-host";

/**
 * The system tray's icons, as the compositor last described them.
 *
 * `useExtensions`' shape and for its reasons: the whole tray, read off the
 * host and again on every change, once for the whole desk.
 */
export const useTray = (
  domicile: DomicileHost,
): readonly DomicileTrayItem[] => {
  const [items, setItems] = useState<readonly DomicileTrayItem[]>([]);

  useEffect(
    () => watchHost(domicile, "traychanged", itemsOf, setItems),
    [domicile],
  );

  return items;
};

const itemsOf = ({
  tray,
}: DomicileHost): readonly DomicileTrayItem[] | undefined => tray ?? undefined;
